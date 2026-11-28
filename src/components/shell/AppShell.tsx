"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CoachDock } from "@/components/coach/CoachDock";
import { BrandMark } from "@/components/shell/BrandMark";
import { PageTile } from "@/components/shell/paletteIcons";
import { paletteGrid, paletteMove, type PaletteEntry } from "@/components/shell/paletteLayout";
import { createStore, useStore } from "@/data/local/store";
import { useSyncItems, useSyncStatus, type SyncStatus } from "@/data/sync";
import { locale, msg, t, tx } from "@/lib/i18n";
import { platformSlots, type NavItem } from "@/lib/platform";
import { paletteSports, type Family } from "@/lib/sports";
import { useSportOrder } from "@/data/local/sportOrder";
import { ALWAYS_SHOWN, applySportColors, hiddenNavStore, sportColorsStore } from "@/lib/preferences";
import { useTheme, type ThemeChoice } from "@/lib/theme";

/** Whether the side panel is folded down to its icons. Kept in this browser. */
const collapsedStore = createStore<boolean>("shell.collapsed", false);

export const NAV = [
  { href: "/", label: msg("Dashboard"), group: 0, icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { href: "/calendar", label: msg("Calendar"), group: 0, icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/calendar/library", label: msg("Library"), group: 0, icon: "M5 4h4v16H5zM10 4h4v16h-4zM15 5.200l3.800-1l3.200 14.800l-3.800 1z" },
  { href: "/activities", label: msg("Activities"), group: 0, icon: "M3 12h4l3-8 4 16 3-8h4" },
  { href: "/health", label: msg("Health"), group: 1, icon: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5a4 4 0 0 1 7 2.5c0 5.5-7 10-7 10z" },
  { href: "/fuel", label: msg("Fuel"), group: 1, icon: "M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" },
  { href: "/body", label: msg("Body"), group: 1, icon: "M12 3.5a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 0 0 0-4.4zM6 10.5h12M12 10.5v6M12 16.5l-3 4.5M12 16.5l3 4.5" },
  { href: "/sports", label: msg("Sports"), group: 1, icon: "M12 6.500a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM12 13.500V9.500M10 3h4M12 3v3.500" },
  { href: "/strength", label: msg("Strength"), group: 1, icon: "M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9" },
  { href: "/coach", label: msg("Coach"), group: 2, icon: "M5 5h14v10.5h-8.5L5 20z" },
  { href: "/watch", label: msg("Watch"), group: 3, icon: "M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.400 7.700l.8-4.200h3.600l.8 4.200M9.400 16.300l.8 4.200h3.600l.8-4.200" },
] as const;

/** The web app's sidebar items and the host app's own (platformSlots.nav), in group order. */
export function navItems(): readonly NavItem[] {
  const extra = platformSlots.nav ?? [];
  return extra.length ? [...NAV, ...extra].sort((a, b) => a.group - b.group) : NAV;
}

/**
 * Pages inside other pages: chips under the palette's grid, and search results that say where they live. The
 * person's sports come first, in their own order (the four main ones while nothing is known).
 */
const extraPages = (families: readonly Family[], saved: readonly string[]) => [
  ...paletteSports(families, saved).map((p) => ({ ...p, where: msg("Sports") })),
  { href: "/health/energy", label: msg("Energy"), where: msg("Health") },
  { href: "/calendar/workout", label: msg("Plan a workout"), where: msg("Calendar") },
  { href: "/connect", label: msg("Connections"), where: msg("Profile") },
];

/**
 * Which top-level item a path belongs to: the most specific one. Energy opens from Health; the workout builder from
 * Calendar; Plans is the Library's other tab.
 */
export function currentNav(pathname: string): string {
  if (pathname === "/") return "/";
  const path = pathname === "/calendar/plans" || pathname.startsWith("/calendar/plans/") ? "/calendar/library" : pathname;
  const hit = navItems().filter((n) => n.href !== "/" && (path === n.href || path.startsWith(n.href + "/")));
  return hit.length ? hit.reduce((a, b) => (b.href.length > a.href.length ? b : a)).href : "";
}

function groundFor(pathname: string): string | undefined {
  if (pathname.startsWith("/fuel")) return "fuel";
  if (pathname.startsWith("/body")) return "body";
  if (pathname.startsWith("/strength")) return "strength";
  if (pathname === "/health") return "health";
  return undefined;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const current = currentNav(pathname);
  const [menu, setMenu] = useState(false);
  const [account, setAccount] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const [palette, setPalette] = useState(false);
  const { choice, setChoice } = useTheme();
  const collapsed = useStore(collapsedStore, false);
  const hidden = useStore(hiddenNavStore, []);
  const sportColors = useStore(sportColorsStore, {});
  const shown = navItems().filter((n) => ALWAYS_SHOWN.includes(n.href) || !hidden.includes(n.href));
  useEffect(() => applySportColors(sportColors), [sportColors]);
  const accountRef = useRef<HTMLDivElement>(null);
  const sync = useSyncStatus();
  const watchState = useSyncItems("watch.state")[0]?.body;
  // Signed out, the rail keeps the sample athlete's watch; signed in, the watch the phone reported.
  const watchName = sync.viewer ? watchState?.model ?? watchState?.name ?? t("Watch") : "PACE Pro";
  const initial = (sync.viewer?.displayName || sync.viewer?.handle || "A").slice(0, 1).toUpperCase();

  const closeAll = () => { setMenu(false); setAccount(false); setAppearance(false); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "Escape") { setPalette(false); setAccount(false); }
    };
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setAccount(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, []);

  return (
    <div className="ground" data-ground={groundFor(pathname)}>
      <a href="#main" className="sr-only">{t("Skip to content")}</a>
      <div className="shell">
        <aside className="rail" aria-label={t("Sidebar")} data-collapsed={collapsed}>
          {platformSlots.railTop ? <platformSlots.railTop /> : null}
          <div className="rail-top">
            <Link href="/" className="rail-brand" aria-label="C-LINK" onClick={closeAll}><BrandMark /><span className="rail-label">C-LINK</span></Link>
            <button type="button" className="rail-toggle" aria-label={collapsed ? t("Expand the side panel") : t("Collapse the side panel")} aria-expanded={!collapsed}
              data-tip={collapsed ? t("Expand") : undefined} onClick={() => collapsedStore.set(!collapsed)}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 5h16v14H4zM9.500 5v14" /></svg>
            </button>
          </div>
          <button type="button" className="rail-search" aria-label={t("Search")} data-tip={collapsed ? `${t("Search")}  ⌘K` : undefined} onClick={() => setPalette(true)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className="rail-label">{t("Search")}</span>
            <kbd className="kbd">⌘K</kbd>
          </button>
          <button type="button" className="rail-item menu-btn" aria-label={t("Menu")} aria-expanded={menu} aria-controls="main-nav" onClick={() => setMenu((m) => !m)}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <nav aria-label={t("Main")} className="rail-nav" id="main-nav" data-open={menu}>
            {shown.map((n, i) => (
              <Link key={n.href} href={n.href} onClick={closeAll} className="rail-item" data-first={i > 0 && shown[i - 1].group !== n.group ? "true" : undefined}
                aria-label={tx("nav", n.label)} data-tip={collapsed ? tx("nav", n.label) : undefined} aria-current={current === n.href ? "page" : undefined}>
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={n.icon} /></svg>
                <span className="rail-label">{tx("nav", n.label)}</span>
              </Link>
            ))}
          </nav>
          {platformSlots.railNote ? <platformSlots.railNote /> : null}
          <div ref={accountRef} className="rail-account">
            <Link href="/watch" className="watch-link" aria-label={t("Watch: {name}", { name: watchName })} onClick={closeAll}><i aria-hidden="true" /><span className="rail-label">{watchName}</span></Link>
            <button type="button" aria-label={t("Account and appearance")} aria-expanded={account} className="avatar" onClick={() => { setAccount((a) => !a); setAppearance(false); }}>{initial}{platformSlots.accountBadge ? <platformSlots.accountBadge /> : null}</button>
            {account ? (
              <div className="popover acct" role="dialog" aria-label={t("Account and appearance")}>
                {sync.viewer ? (
                  <div className="acct-head">
                    <span className="acct-avatar" aria-hidden="true">{initial}</span>
                    <span className="acct-who">
                      <strong>{sync.viewer.displayName || `@${sync.viewer.handle}`}</strong>
                      <span className="acct-sync" data-state={syncState(sync)}><i aria-hidden="true" />{syncLine(sync)}</span>
                    </span>
                  </div>
                ) : null}
                <div className="acct-rows">
                  <div className="acct-sub" data-open={appearance}
                    onMouseEnter={() => setAppearance(true)} onMouseLeave={() => setAppearance(false)}>
                    <button type="button" aria-haspopup="menu" aria-expanded={appearance} onClick={() => setAppearance((a) => !a)}>
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3a9 9 0 0 0 0 18c1.400 0 2-.9 2-1.800c0-1.200-1-1.500-1-2.700c0-1 .8-1.500 1.800-1.500H17a4 4 0 0 0 4-4c0-4.400-4-8-9-8zM7.500 11.500h.01M10 7.500h.01M15 7.500h.01" /></svg>
                      <span>{t("Appearance")}</span>
                      <svg className="acct-chev" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6l-6 6" /></svg>
                    </button>
                    {appearance ? (
                      <div className="popover acct-flyout" role="menu" aria-label={t("Appearance")}>
                        {THEMES.map((th) => (
                          <button key={th.value} type="button" role="menuitemradio" aria-checked={choice === th.value} onClick={() => setChoice(th.value)}>
                            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={th.icon} /></svg>
                            <span>{tx("theme", th.label)}</span>
                            <i className="acct-radio" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Link href="/connect" onClick={closeAll}>
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM4.500 20c.8-3.500 3.800-5.500 7.500-5.500s6.700 2 7.500 5.500" /></svg>
                    <span>{t("Profile and connections")}</span>
                    <svg className="acct-chev" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6l-6 6" /></svg>
                  </Link>
                  {platformSlots.settingsHref ? (
                    <Link href={platformSlots.settingsHref} onClick={closeAll}>
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.1a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3a1.700 1.700 0 0 0-1 1.500V21a2 2 0 0 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500a1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800a1.700 1.700 0 0 0-1.500-1H3a2 2 0 0 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100a1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.1a1.700 1.700 0 0 0 1.800.3H9a1.700 1.700 0 0 0 1-1.500V3a2 2 0 0 1 4 0v.1a1.700 1.700 0 0 0 1 1.500a1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.1a1.700 1.700 0 0 0-.3 1.800V9a1.700 1.700 0 0 0 1.500 1H21a2 2 0 0 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z" /></svg>
                      <span>{t("Settings")}</span>
                    </Link>
                  ) : null}
                  {platformSlots.accountItem ? <platformSlots.accountItem /> : null}
                </div>
              </div>
            ) : null}
          </div>
        </aside>
        <div id="main" className="shell-main">{children}</div>
        <CoachDock />
      </div>
      {palette ? <Palette onClose={() => setPalette(false)} /> : null}
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: msg("Light"), icon: "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.600 4.600l1.400 1.400M18 18l1.400 1.400M2.500 12h2M19.500 12h2M4.600 19.400L6 18M18 6l1.400-1.400" },
  { value: "dark", label: msg("Dark"), icon: "M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z" },
  { value: "system", label: msg("System"), icon: "M4 5h16v11H4zM9 20h6M12 16v4" },
];

/** The colour of the account menu's sync dot. */
function syncState(sync: SyncStatus): "bad" | "waiting" | "ok" {
  if (sync.error) return "bad";
  if (sync.unsent > 0 || sync.lastSyncedAt == null) return "waiting";
  return "ok";
}

/** The account menu's one-line sync state. */
export function syncLine(sync: SyncStatus): string {
  if (sync.error) return t("Sync didn't work");
  if (sync.unsent > 0) return sync.unsent === 1 ? t("1 change not saved yet") : t("{n} changes not saved yet", { n: sync.unsent });
  if (sync.lastSyncedAt == null) return t("Syncing…");
  return t("Synced {time}", { time: new Date(sync.lastSyncedAt).toLocaleTimeString(locale("en-US"), { hour: "2-digit", minute: "2-digit", hour12: false }) });
}

/** The part of a label that matches what was typed, in the accent colour. */
function Match({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + needle.length)}</mark>{text.slice(at + needle.length)}</>;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const needle = q.trim().toLowerCase();
  // Shown in the app's language; the search also finds the English name.
  // The person's sports, read when the palette opens; the Sports data loads only then.
  const [families, setFamilies] = useState<Family[]>([]);
  useEffect(() => {
    let live = true;
    import("@/data/sports").then((m) => m.loadSportFamilies()).then((f) => { if (live) setFamilies(f); }, () => undefined);
    return () => { live = false; };
  }, []);
  const sportOrder = useSportOrder();
  const extra = useMemo(() => extraPages(families, sportOrder), [families, sportOrder]);
  const grid = useMemo(() => paletteGrid(navItems(), extra).map((e) => ({ ...e, english: e.label, label: t(e.label), where: e.where && t(e.where) })), [extra]);
  const items: PaletteEntry[] = useMemo(() => {
    if (!needle) return grid;
    const starts = (i: typeof grid[number]) => i.label.toLowerCase().startsWith(needle) || i.english.toLowerCase().startsWith(needle);
    const hits = grid.filter((i) => i.label.toLowerCase().includes(needle) || i.english.toLowerCase().includes(needle))
      .sort((a, b) => Number(!starts(a)) - Number(!starts(b)));
    const ask = { href: `/coach?ask=${encodeURIComponent(q.trim())}`, label: t("Ask Coach about “{q}”", { q: q.trim() }), ask: true };
    return [...hits, ask].map((e, i) => ({ ...e, row: i, col: 0 }));
  }, [grid, needle, q]);
  const go = (href: string) => { onClose(); router.push(href); };
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, items]);
  const asking = items.find((i) => i.ask);

  const row = (i: PaletteEntry, k: number) => (
    <Link key={i.href} href={i.href} data-active={k === active} className="pal-item" onClick={onClose} onMouseMove={() => setActive(k)}>
      <PageTile href={i.ask ? "/coach" : i.href} icon={i.icon} />
      <span className="pal-label">{i.ask ? i.label : <Match text={i.label} needle={needle} />}</span>
      {needle && i.where ? <span className="pal-where">{i.where}</span> : null}
      {k === active ? <kbd className="pal-kbd">↵</kbd> : null}
    </Link>
  );

  let body: React.ReactNode;
  if (!needle) {
    const rows = grid.filter((e) => !extra.some((x) => x.href === e.href));
    const groups = [...new Set(navItems().map((n) => n.group))];
    body = (
      <>
        <nav aria-label={t("Pages")} className="pal-pages">
          {groups.map((g) => (
            <div key={g} className="pal-group">
              {rows.map((e, k) => (navItems().find((n) => n.href === e.href)?.group === g ? row(e, k) : null))}
            </div>
          ))}
        </nav>
        <div className="pal-chips">
          {grid.slice(rows.length).map((e, j) => {
            const k = rows.length + j;
            return (
              <Link key={e.href} href={e.href} data-active={k === active} className="pal-chip" onClick={onClose} onMouseMove={() => setActive(k)}>
                <PageTile href={e.href} size={22} />{e.label}
              </Link>
            );
          })}
        </div>
      </>
    );
  } else {
    const pages = items.filter((i) => !i.ask);
    body = (
      <>
        {pages.length ? <div className="pal-results">{pages.map((i, k) => row(i, k))}</div> : null}
        {asking ? <div className="pal-results pal-ask">{row(asking, pages.length)}</div> : null}
      </>
    );
  }

  return (
    <div className="palette-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("Go to")}>
        <label className="pal-search">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20" /></svg>
          <input autoFocus aria-label={t("Go to a page")} placeholder={t("Go to a page…")} value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp" || (!needle && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) {
                e.preventDefault(); setActive((a) => paletteMove(items, a, e.key));
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && asking) { e.preventDefault(); go(asking.href); return; }
              if (e.key === "Enter" && items[active]) go(items[active].href);
            }} />
          <kbd className="pal-kbd">esc</kbd>
        </label>
        <div className="pal-body" ref={list}>{body}</div>
        <div className="pal-foot" aria-hidden="true">
          <span><kbd className="pal-kbd">↑</kbd><kbd className="pal-kbd">↓</kbd>{needle ? null : <><kbd className="pal-kbd">←</kbd><kbd className="pal-kbd">→</kbd></>} {t("Move")}</span>
          <span><kbd className="pal-kbd">↵</kbd> {t("Open")}</span>
          {needle ? <span><kbd className="pal-kbd">⌘</kbd><kbd className="pal-kbd">↵</kbd> {t("Ask Coach")}</span> : null}
          <span className="pal-anywhere"><kbd className="pal-kbd">⌘</kbd><kbd className="pal-kbd">K</kbd> {t("Anywhere")}</span>
        </div>
      </div>
    </div>
  );
}
