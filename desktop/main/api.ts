// The web app's API routes (src/app/api/**/route.ts), answered in the main process.
import { NextRequest } from "next/server";
import type { CookieJar } from "./cookieJar";
import { runInRequest } from "./requestScope";
import { API_ROUTES } from "./apiRoutes.gen";

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

const segments = (path: string) => path.split("/").filter(Boolean);

function match(pattern: string, path: string): Record<string, string> | null {
  const want = segments(pattern), got = segments(path);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const dynamic = /^\[(\w+)\]$/.exec(want[i]);
    if (dynamic) params[dynamic[1]] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

// Static routes win over dynamic ones, as in Next.
const ROUTES = [...API_ROUTES].sort((a, b) => Number(a.pattern.includes("[")) - Number(b.pattern.includes("[")));

export async function answerApi(request: Request, jar: CookieJar): Promise<Response> {
  const url = new URL(request.url);
  for (const route of ROUTES) {
    const params = match(route.pattern, url.pathname);
    if (!params) continue;
    const handler = (route.module as Record<string, Handler | undefined>)[request.method];
    if (!handler) return Response.json({ error: "method" }, { status: 405 });
    // The host the web app's same-site checks compare the Origin header with.
    // Chromium sends neither Origin nor Sec-Fetch-Site to a custom scheme. Only the app's own pages can address
    // clink://app (the window never shows another site while it can reach it), so every request is same-origin.
    const headers = new Headers(request.headers);
    headers.set("host", url.host);
    headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
    headers.set("origin", `${url.protocol}//${url.host}`);
    headers.set("sec-fetch-site", "same-origin");
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const next = new NextRequest(url.href, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined });
    try {
      return await runInRequest({ jar, path: url.pathname, headers }, async () => handler(next, { params: Promise.resolve(params) }));
    } catch (error) {
      console.error(`API ${request.method} ${url.pathname} failed:`, error);
      return Response.json({ error: "internal", message: "Something went wrong in the app." }, { status: 500 });
    } finally {
      void jar.save();
    }
  }
  return Response.json({ error: "notFound" }, { status: 404 });
}
