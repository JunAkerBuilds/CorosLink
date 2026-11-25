// `next/server` in the main process: route handlers get a Request with `nextUrl`, as in Next.
export class NextRequest extends Request {
  readonly nextUrl: URL;
  constructor(input: string | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(typeof input === "string" ? input : input.href);
  }
}

export const NextResponse = {
  json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
};
