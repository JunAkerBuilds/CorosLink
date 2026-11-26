// The "Download" button on every video in the YouTube tab. The main process puts it into YouTube's page from a
// script world of its own (YouTube's scripts can't see or call it), and a click comes back as a console message
// tagged with a secret only that world knows: no Node, no preload, no IPC. The main process takes nothing from it but
// a YouTube video id and a title, and queues that video like any other download.

/** The isolated world the buttons live in (any number not used by Electron itself). */
export const BUTTON_WORLD = 7311;

import { t } from "@/lib/i18n";

const ID = /^[\w-]{11}$/;

export const BUTTON_CSS = `
.clink-dl{position:absolute;top:8px;right:8px;z-index:60;display:inline-flex;align-items:center;height:28px;padding:0 12px;
  border:0;border-radius:999px;background:#1fa463;color:#fff;font:700 12.5px/1 Roboto,Arial,sans-serif;letter-spacing:.01em;cursor:pointer;
  box-shadow:0 1px 6px rgba(0,0,0,.35);transition:box-shadow .15s ease,background-color .15s ease,transform .15s ease}
.clink-dl:hover,.clink-dl:focus-visible{background:#25c275;outline:none;transform:translateY(-1px);
  box-shadow:0 0 0 2px rgba(37,194,117,.45),0 0 18px 4px rgba(37,194,117,.75)}
.clink-dl[data-state="queued"],.clink-dl[data-state="working"]{background:#178a52}
.clink-dl[data-state="done"]{background:#0f6e40}
.clink-dl[data-state="failed"]{background:#c9473f;box-shadow:0 1px 6px rgba(0,0,0,.35)}
`;

/**
 * The script that adds the buttons: to every link that's a video's thumbnail (watch pages and Shorts), kept right as
 * YouTube reuses its tiles for other videos. `tag` prefixes the message a click logs.
 */
export function buttonsScript(tag: string): string {
  return `(() => {
  if (window.__clinkButtons) return;
  window.__clinkButtons = true;
  const TAG = ${JSON.stringify(tag)};
  const ID = /^[\\w-]{11}$/;
  const states = new Map();
  const idOf = (href) => {
    try {
      const u = new URL(href, location.origin);
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = /^\\/shorts\\/([\\w-]{11})/.exec(u.pathname);
      return m ? m[1] : null;
    } catch { return null; }
  };
  const CARD = "ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, ytd-reel-item-renderer, yt-lockup-view-model, ytm-shorts-lockup-view-model";
  const titleOf = (a) => {
    const card = a.closest(CARD) || a.parentElement;
    const t = card && card.querySelector(".ytLockupMetadataViewModelTitle, .yt-lockup-metadata-view-model__title, #video-title, #video-title-link, h3 a, h3");
    return ((t && (t.textContent || t.getAttribute("title"))) || a.getAttribute("title") || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 200);
  };
  const ADS = "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer";
  const LABEL = ${JSON.stringify({ queued: t("Queued"), working: t("Downloading…"), done: `✓ ${t("In library")}`, failed: t("Didn't download") })};
  const show = (b) => {
    const s = states.get(b.dataset.clinkId);
    b.textContent = s ? (LABEL[s] || s) : ${JSON.stringify(`↓ ${t("Download MP3")}`)};
    if (s && LABEL[s]) b.dataset.state = s; else delete b.dataset.state;
  };
  const stop = (e) => { e.stopPropagation(); };
  const add = (a) => {
    const id = idOf(a.getAttribute("href") || "");
    let b = a.querySelector(":scope > button.clink-dl");
    // Thumbnails only, and never an ad's.
    if (!id || !ID.test(id) || !a.querySelector("img, yt-image, yt-thumbnail-view-model") || a.closest(ADS)) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement("button");
      b.type = "button";
      b.className = "clink-dl";
      for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "touchstart"]) b.addEventListener(ev, stop);
      b.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const vid = b.dataset.clinkId;
        if (!vid || states.get(vid) === "queued" || states.get(vid) === "working" || states.get(vid) === "done") return;
        states.set(vid, "queued");
        document.querySelectorAll("button.clink-dl").forEach((x) => { if (x.dataset.clinkId === vid) show(x); });
        console.log(TAG + JSON.stringify({ id: vid, title: titleOf(a) }));
      });
      if (getComputedStyle(a).position === "static") a.style.position = "relative";
      a.appendChild(b);
    }
    if (b.dataset.clinkId !== id) { b.dataset.clinkId = id; show(b); }
  };
  // Light on YouTube's page: work only when the browser is idle, never while the page can't be seen, and only on
  // links that are new or now point at another video.
  const done = new WeakMap();
  let pending = false;
  const scan = () => {
    pending = false;
    if (document.hidden) return;
    for (const a of document.querySelectorAll('a[href*="/watch?v="], a[href^="/shorts/"]')) {
      const href = a.getAttribute("href");
      if (done.get(a) === href && a.querySelector(":scope > button.clink-dl")) continue;
      add(a);
      done.set(a, href);
    }
  };
  const later = () => {
    if (pending || document.hidden) return;
    pending = true;
    requestIdleCallback(scan, { timeout: 700 });
  };
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  document.addEventListener("visibilitychange", later);
  // Videos already in the library, told once when the page loads.
  window.__clinkKnow = (ids) => {
    for (const id of ids) if (!states.has(id)) states.set(id, "done");
    document.querySelectorAll("button.clink-dl").forEach(show);
  };
  window.__clinkMark = (id, state) => {
    states.set(id, state);
    document.querySelectorAll("button.clink-dl").forEach((b) => { if (b.dataset.clinkId === id) show(b); });
  };
  scan();
})();`;
}

/** A click's message, when it carries the tag and a real video id; anything else is nobody's click. */
export function readClick(message: string, tag: string): { id: string; title: string } | null {
  if (!message.startsWith(tag)) return null;
  try {
    const d = JSON.parse(message.slice(tag.length)) as { id?: unknown; title?: unknown };
    if (typeof d.id !== "string" || !ID.test(d.id)) return null;
    const title = typeof d.title === "string" ? d.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) : "";
    return { id: d.id, title };
  } catch {
    return null;
  }
}
