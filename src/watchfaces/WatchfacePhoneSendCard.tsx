import { localizedText, renderLocalizedText, type LocalizableText, t, useLanguage } from "../i18n/watchfaces";
import { useEffect, useRef, useState } from "react";
import { Check, CircleCheck, Copy, EyeOff, Loader2, QrCode, Share, Smartphone } from "lucide-react";
import type { CorosWatchfaceArchive } from "../../electron/types";
import type { WatchfacePhoneSend, WatchfacePhoneSendStatus } from "../../electron/watchfacePhoneSendTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { apiErrorMessage } from "./watchLink";

/**
 * The Send dialog's Send to iPhone card. Show code serves this face on the local
 * network and shows the QR code C-LINK scans to fetch it (macOS, Windows and
 * Linux); AirDrop hands it over directly on macOS. Either way the face lands in
 * C-LINK's My Faces, ready to install on the watch from the phone.
 */
export function WatchfacePhoneSendCard({ api, archive, name, disabled }: {
  api: CorosLinkApi;
  archive: CorosWatchfaceArchive;
  /** The name typed in the Send dialog, which C-LINK lists the face under. */
  name: string;
  disabled: boolean;
}) {
  useLanguage();
  const [share, setShare] = useState<WatchfacePhoneSend | null>(null);
  const [status, setStatus] = useState<WatchfacePhoneSendStatus | null>(null);
  const [busy, setBusy] = useState<"code" | "airdrop" | null>(null);
  const [error, setError] = useState<LocalizableText | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const shown = useRef<WatchfacePhoneSend | null>(null);
  shown.current = share;
  const airDrop = api.platform === "darwin" && typeof api.airDropCorosWatchfaceToIphone === "function";
  const current = share && status?.expiresAt === share.expiresAt ? status : null;

  // Pushed by main as the phone downloads. Only the code on screen counts (matched by its
  // expiry): a replaced code reports once more as it stops.
  useEffect(() => api.onCorosWatchfacePhoneSendStatus?.(next => {
    if (next.expiresAt === shown.current?.expiresAt) setStatus(next);
  }), [api]);

  // A code describes one archive and name: a rebuild, a rename or closing the dialog ends it.
  useEffect(() => () => {
    request.current++;
    setShare(null);
    setCopied(false);
    if (shown.current) void api.stopCorosWatchfacePhoneSend?.();
  }, [api, archive.archiveId, name]);

  useEffect(() => {
    if (!share) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [share]);

  // Main stops serving at expiry (or when another code replaces this one).
  useEffect(() => {
    if (share && (now >= share.expiresAt || current?.active === false)) setShare(null);
  }, [current?.active, now, share]);

  async function showCode() {
    if (!api.startCorosWatchfacePhoneSend || busy) return;
    const id = ++request.current;
    setBusy("code"); setError(null); setCopied(false);
    try {
      const next = await api.startCorosWatchfacePhoneSend({ archiveId: archive.archiveId, name, firmwareType: archive.firmwareType });
      if (request.current !== id) { void api.stopCorosWatchfacePhoneSend?.(); return; }
      setShare(next);
      setNow(Date.now());
    } catch (caught) {
      if (request.current === id) setError(apiErrorMessage(caught, "Could not prepare the face for your iPhone."));
    } finally { setBusy(null); }
  }

  function hideCode() {
    request.current++;
    setShare(null);
    void api.stopCorosWatchfacePhoneSend?.();
  }

  async function sendWithAirDrop() {
    if (!api.airDropCorosWatchfaceToIphone || busy) return;
    setBusy("airdrop"); setError(null);
    try { await api.airDropCorosWatchfaceToIphone({ archiveId: archive.archiveId, name, firmwareType: archive.firmwareType }); }
    catch (caught) { setError(apiErrorMessage(caught, "Could not open AirDrop.")); }
    finally { setBusy(null); }
  }

  async function copyLink() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { setError(localizedText(() => t("Could not copy the link."))); }
  }

  if (typeof api.startCorosWatchfacePhoneSend !== "function") return null;
  const remaining = share ? Math.max(0, Math.ceil((share.expiresAt - now) / 1000)) : 0;

  return <section className="wf-send-card wf-send-phone" aria-labelledby="wf-send-phone-title">
    <div className="wf-send-card-head">
      <h3 id="wf-send-phone-title"><Smartphone size={15} aria-hidden="true" />{t("Send to iPhone")}</h3>
      {share ? <span className="wf-send-phone-timer">{t("Expires in {{p0}}:{{p1}}", { p0: String(Math.floor(remaining / 60)), p1: String(String(remaining % 60).padStart(2, "0")) })}</span> : null}
    </div>
    {share ? <>
      <figure className="wf-send-phone-code">
        <img src={share.qrDataUrl} width={168} height={168} alt={t("Code for C-LINK on iPhone to receive {{p0}}", { p0: String(share.name) })} />
      </figure>
      {current?.sending
        ? <p className="watch-link-note" role="status"><Loader2 className="spin" size={13} aria-hidden="true" /> {t("Sending to your iPhone…")}</p>
        : current && current.received > 0
          ? <p className="watch-link-note is-success" role="status"><CircleCheck size={13} aria-hidden="true" /> {t("On your iPhone. Install it from C-LINK’s My Faces.")}</p>
          : <p role="status">{t("Scan with the iPhone Camera, or in C-LINK: My Faces → + → Scan code from CorosLink.")}</p>}
      {!current?.sending && !current?.received
        ? <small>{t("Your iPhone needs the same Wi-Fi as this computer. No shared Wi-Fi? Join your iPhone’s Personal Hotspot from this computer, then show the code again.")}</small>
        : null}
      <div className="wf-send-phone-actions">
        <button type="button" className="secondary-button watch-link-button" onClick={() => void copyLink()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? t("Copied") : t("Copy link")}
        </button>
        <button type="button" className="secondary-button watch-link-button" onClick={hideCode}>
          <EyeOff size={14} aria-hidden="true" />{t("Hide code")}</button>
      </div>
    </> : <>
      <p>{t("Add it to C-LINK, then install it on your watch from your phone.")}</p>
      <div className="wf-send-phone-actions">
        <button type="button" className="secondary-button watch-link-button" disabled={disabled || Boolean(busy)} onClick={() => void showCode()}>
          {busy === "code" ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <QrCode size={14} aria-hidden="true" />}{t("Show code")}</button>
        {airDrop ? <button type="button" className="secondary-button watch-link-button" disabled={disabled || Boolean(busy)}
          title={t("Send with AirDrop: no shared Wi-Fi needed")} onClick={() => void sendWithAirDrop()}>
          {busy === "airdrop" ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Share size={14} aria-hidden="true" />}AirDrop
        </button> : null}
      </div>
      <small>{airDrop ? t("Show code needs shared Wi-Fi; AirDrop doesn’t. If the iPhone asks, choose Open in C-LINK.")
        : t("Sends over your Wi-Fi network. The iPhone scans a code to receive it.")}</small>
    </>}
    {error ? <p className="watch-link-note is-error" role="alert">{renderLocalizedText(error)}</p> : null}
  </section>;
}
