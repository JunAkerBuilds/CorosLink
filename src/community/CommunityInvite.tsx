import { t, useLanguage } from "../i18n";
import { useEffect, useRef } from "react";
import { ArrowUpRight, Bug, HelpCircle, LifeBuoy, MessagesSquare, Smartphone, X } from "lucide-react";
import appLogo from "../../build/icon-animated.svg";
import "./communityInvite.css";

export const TESTFLIGHT_URL = "https://testflight.apple.com/join/CHeNwjVn";
export const DISCORD_URL = "https://discord.gg/3x9rErHyjR";
const ISSUES_URL = "https://github.com/JunAkerBuilds/CorosLink/issues";

/**
 * Bump when there's something new to announce: everyone who hasn't seen this
 * id gets the invite once, on the first launch the welcome tour isn't open.
 */
const INVITE_ID = "clink-beta-2026-10";
const SEEN_KEY = "coroslink.communityInvite.seen";

export function hasSeenCommunityInvite(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === INVITE_ID;
  } catch {
    return false;
  }
}

export function rememberCommunityInvite(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, INVITE_ID);
  } catch {
    // The dialog closes either way; it may show again next launch.
  }
}

export type CommunityInviteMode = "announcement" | "support";

interface InviteCard {
  id: string;
  href: string;
  icon: typeof Smartphone;
  title: string;
  body: string;
  action: string;
}

function inviteCards(mode: CommunityInviteMode): InviteCard[] {
  const testflight: InviteCard = {
    id: "testflight",
    href: TESTFLIGHT_URL,
    icon: Smartphone,
    title: t("Test C-LINK on iPhone"),
    body: t("I'm building C-LINK, the iPhone app. Have an iPhone? Join the TestFlight beta and help me test it."),
    action: t("Join the beta"),
  };
  const discord: InviteCard = {
    id: "discord",
    href: DISCORD_URL,
    icon: MessagesSquare,
    title: t("Join the Discord"),
    body: t("Updates, support, feedback and watch faces from other CorosLink users."),
    action: t("Join Discord"),
  };
  return mode === "support" ? [discord, testflight] : [testflight, discord];
}

export function CommunityInvite({ mode, onClose }: { mode: CommunityInviteMode; onClose: () => void }) {
  useLanguage();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Focus the dialog, not a card, so it opens without a focus ring on either link.
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  const support = mode === "support";
  return (
    <div
      className="community-invite-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`community-invite is-${mode}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="community-invite-title"
        aria-describedby="community-invite-description"
      >
        <button className="community-invite-close" type="button" aria-label={t("Close")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
        <header className="community-invite-header">
          {support ? (
            <span className="community-invite-glyph" aria-hidden="true">
              <LifeBuoy size={24} />
            </span>
          ) : (
            <img className="community-invite-logo" src={appLogo} alt="" width={46} height={46} aria-hidden="true" />
          )}
          <div>
            <p className="community-invite-eyebrow">{support ? t("Support") : t("From the developer")}</p>
            <h2 id="community-invite-title">
              {support ? t("Get help with CorosLink") : t("CorosLink is coming to iPhone")}
            </h2>
            <p id="community-invite-description">
              {support
                ? t("Ask questions, report problems and hear about updates first in the CorosLink Discord.")
                : t("Help test the iPhone app before it launches, and join the Discord for updates and support.")}
            </p>
          </div>
        </header>

        <div className="community-invite-cards">
          {inviteCards(mode).map(({ id, href, icon: Icon, title, body, action }) => (
            <a
              key={id}
              className={`community-invite-card is-${id}`}
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              <span className="community-invite-card-icon" aria-hidden="true">
                <Icon size={20} />
              </span>
              <span className="community-invite-card-title">{title}</span>
              <span className="community-invite-card-body">{body}</span>
              <span className="community-invite-card-action">
                {action}
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </a>
          ))}
        </div>

        <footer className="community-invite-footer">
          {support ? (
            <a className="community-invite-footnote" href={ISSUES_URL} target="_blank" rel="noreferrer">
              <Bug size={13} aria-hidden="true" />
              {t("Prefer GitHub? Report an issue")}
            </a>
          ) : (
            <p className="community-invite-footnote">
              <HelpCircle size={13} aria-hidden="true" />
              {t("Both links stay under Help & links (?) and Support.")}
            </p>
          )}
          <button className="secondary-button community-invite-dismiss" type="button" onClick={onClose}>
            {support ? t("Close") : t("Maybe later")}
          </button>
        </footer>
      </section>
    </div>
  );
}
