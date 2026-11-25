// Which API request is being handled, so `next/headers` in the web app's server code reads that request's cookies.
import { AsyncLocalStorage } from "node:async_hooks";
import type { CookieJar } from "./cookieJar";

export interface RequestScope { jar: CookieJar; path: string; headers: Headers }

const storage = new AsyncLocalStorage<RequestScope>();

export const runInRequest = <T>(scope: RequestScope, work: () => Promise<T>): Promise<T> => storage.run(scope, work);

export function currentRequest(): RequestScope {
  const scope = storage.getStore();
  if (!scope) throw new Error("cookies() was called outside an API request.");
  return scope;
}
