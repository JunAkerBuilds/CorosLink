// A fake COROS map server for tests: serves one file per URL with an ETag, honours Range + If-Range like S3, and
// can drop the connection partway through.

export interface FakeFile { bytes: Buffer; etag: string }

export interface FakeServer {
  files: Map<string, FakeFile>;
  /** Every request: url and the headers that matter. */
  calls: { url: string; range?: string; ifRange?: string }[];
  /** Ignore Range headers (answer 200 with the whole file). */
  ignoreRange: boolean;
  /** Drop the next body after this many bytes. */
  failAfter?: number;
  /** Hold every body until released (for cancel and queue tests). */
  hold?: Promise<void>;
  fetch: typeof fetch;
}

export function fakeServer(): FakeServer {
  const server: FakeServer = {
    files: new Map(), calls: [], ignoreRange: false,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const headers = new Headers(init?.headers);
      const range = headers.get("range") ?? undefined, ifRange = headers.get("if-range") ?? undefined;
      server.calls.push({ url, range, ifRange });
      if (url.endsWith(".json")) {
        const body = server.files.get(url);
        return body ? new Response(new Uint8Array(body.bytes), { headers: { "content-type": "application/json" } }) : new Response("no", { status: 404 });
      }
      const file = server.files.get(url);
      if (!file) return new Response("missing", { status: 404 });
      let start = 0, status = 200;
      const m = /^bytes=(\d+)-$/.exec(range ?? "");
      if (m && !server.ignoreRange && (!ifRange || ifRange === file.etag)) {
        start = Number(m[1]);
        if (start >= file.bytes.length) return new Response(null, { status: 416 });
        status = 206;
      }
      const slice = file.bytes.subarray(start);
      const failAfter = server.failAfter;
      server.failAfter = undefined;
      const hold = server.hold;
      const signal = init?.signal;
      const cut = failAfter === undefined ? slice.length : Math.min(failAfter, slice.length);
      const half = Math.floor(cut / 2);
      // Pulled one piece per read, so the drop comes only after the reader took every byte before it.
      const pieces: (Uint8Array | "end")[] = [new Uint8Array(slice.subarray(0, half)), new Uint8Array(slice.subarray(half, cut)), "end"];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
        async pull(controller) {
          if (hold) await hold;
          if (signal?.aborted) return;
          const piece = pieces.shift();
          if (piece === undefined) return;
          if (piece !== "end") controller.enqueue(piece);
          else if (failAfter !== undefined) controller.error(new Error("connection reset"));
          else controller.close();
        },
      }, { highWaterMark: 0 });
      const h: Record<string, string> = { etag: file.etag, "content-length": String(slice.length) };
      if (status === 206) h["content-range"] = `bytes ${start}-${file.bytes.length - 1}/${file.bytes.length}`;
      return new Response(body, { status, headers: h });
    }) as typeof fetch,
  };
  return server;
}
