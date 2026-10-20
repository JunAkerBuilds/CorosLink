import { useEffect, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";

/** How long after a sign-in the watch panels keep re-reading: the settings and profile are read just after connecting. */
const READ_WINDOW_MS = 60_000;
const POLL_MS = 2_500;

export interface WatchLink {
  /** Connected and signed in, so the watch can be read and written. */
  ready: boolean;
  /** When the current connection signed in; a new value means a new connection. */
  authenticatedAt?: number;
}

/** The watch connection as the Settings watch panels need it, polled while they are open. */
export function useWatchLink(api: CorosLinkApi): WatchLink {
  const [link, setLink] = useState<WatchLink>({ ready: false });
  useEffect(() => {
    let live = true;
    const check = () => {
      void api.getCorosNativeBleStatus().then(status => {
        if (!live) return;
        const ready = Boolean(status?.connected && status.systemBind === "authenticated");
        const authenticatedAt = ready ? status.authenticatedAt : undefined;
        setLink(current => current.ready === ready && current.authenticatedAt === authenticatedAt ? current : { ready, authenticatedAt });
      }).catch(() => { if (live) setLink(current => current.ready ? { ready: false } : current); });
    };
    check();
    const timer = setInterval(check, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [api]);
  return link;
}

/**
 * Loads `load` on mount and on each new connection, then again every few seconds while the watch is
 * connected and what was read is older than the connection (the read finishes just after it).
 */
export function useWatchRead(link: WatchLink, readAt: string | undefined, load: () => void): void {
  useEffect(() => { load(); }, [load, link.authenticatedAt]);
  const stale = link.ready && link.authenticatedAt !== undefined && (!readAt || Date.parse(readAt) < link.authenticatedAt);
  useEffect(() => {
    if (!stale || link.authenticatedAt === undefined) return;
    const left = link.authenticatedAt + READ_WINDOW_MS - Date.now();
    if (left <= 0) return;
    const timer = setInterval(load, POLL_MS);
    const stop = setTimeout(() => clearInterval(timer), left);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [stale, link.authenticatedAt, load]);
}
