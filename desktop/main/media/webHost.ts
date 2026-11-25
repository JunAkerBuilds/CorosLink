// What the music services need from Electron, kept behind an interface so they're tested without it: a sign-in
// window on a session of its own, requests made from that session (so its cookies go with them), and the session's
// cookies and request headers.
export interface SignIn {
  url: string;
  /** The session the window uses; "persist:…" keeps the sign-in between launches. */
  partition: string;
  title: string;
  /** Called with every address the window goes to; true ends the sign-in (the window closes). */
  done?: (url: string) => boolean;
  /** Called with the request headers the window sends to these addresses; true ends the sign-in. */
  headers?: { urls: string[]; seen: (headers: Record<string, string>) => boolean };
}

/** What a browsing window shows now. */
export interface BrowserView { url: string; title: string; canBack: boolean; canForward: boolean }

/** A rectangle in the page's CSS pixels, from its top-left corner. */
export interface Rect { x: number; y: number; width: number; height: number }

/**
 * YouTube shown inside the app's window, over a slot the page keeps for it: this process reads where it is and steers
 * it; the page only says where its slot is.
 */
export interface Browser {
  view(): BrowserView | null;
  go(to: "back" | "forward" | "reload" | { url: string }): void;
  /** Lays it over this rectangle of the page, or hides it (null). */
  place(rect: Rect | null): void;
  /** Shows a video's download state on its buttons ("queued", "working", "done", "failed"). */
  mark(id: string, state: string): void;
  focus(): void;
  close(): void;
}

export interface Browse {
  url: string;
  partition: string;
  title: string;
  /** Addresses the window may go to; anything else is refused. */
  allow: (url: string) => boolean;
  /** Called on every page the window shows (YouTube changes pages without loading them, and that counts too). */
  visited: (view: BrowserView) => void;
  closed: () => void;
  /** A video's "Download" button was clicked: its id (checked) and title as the page shows it. */
  download: (id: string, title: string) => void;
  /** Videos already in the library, so their buttons say so. */
  known: () => string[];
}

export interface WebHost {
  /** Opens the window; resolves with the address that ended it, "headers" when headers did, or null when it was closed. */
  signIn(options: SignIn): Promise<string | null>;
  fetch(partition: string, url: string, init?: RequestInit): Promise<Response>;
  cookies(partition: string, url: string): Promise<{ name: string; value: string }[]>;
  clear(partition: string): Promise<void>;
  /** Opens YouTube inside the app's window (hidden until placed); absent where there are no windows (tests). */
  browse?(options: Browse): Browser;
}

/** No windows (tests, or before the app is ready): every sign-in is refused. */
export const noWeb: WebHost = {
  signIn: async () => null,
  fetch: (_p, url, init) => fetch(url, init),
  cookies: async () => [],
  clear: async () => {},
};
