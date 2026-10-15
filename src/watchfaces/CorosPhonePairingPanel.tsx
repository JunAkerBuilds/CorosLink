import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { useEffect, useState } from "react";
import { EyeOff, Loader2, QrCode, ShieldAlert, Smartphone } from "lucide-react";
import type { CorosPhonePairingCode } from "../../electron/corosNativeBleTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { apiErrorMessage } from "./watchLink";

/**
 * Shows the pairing QR for C-LINK, the iPhone app, which hands the phone the COROS
 * account key this app uses to authenticate with the watch. The code is shown only
 * on request and hides after two minutes; the key it carries does not expire.
 */
export function CorosPhonePairingPanel({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const [pairing, setPairing] = useState<CorosPhonePairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const available = typeof api.createCorosPhonePairingCode === "function";

  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= pairing.expiresAt) setPairing(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function show() {
    if (!api.createCorosPhonePairingCode) return;
    setBusy(true);
    setError(null);
    try {
      setPairing(await api.createCorosPhonePairingCode());
      setNow(Date.now());
    } catch (reason) {
      setError(apiErrorMessage(reason, t("Could not create a pairing code.")));
    } finally {
      setBusy(false);
    }
  }

  const remaining = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div className="watch-link-phone">
      <div className="watch-link-phone-copy">
        <h3><Smartphone size={16} aria-hidden="true" />{" "}{t("C-LINK for iPhone")}</h3>
        <p>{t("Install faces from your iPhone over Bluetooth. Scan this code in the app to give it the same watch key CorosLink uses.")}</p>
        <ol>
          <li>{t("Open C-LINK on your iPhone and tap")}{" "}<strong>{t("Scan pairing code")}</strong>.</li>
          <li>{t("Point the camera at the code. It hides after two minutes.")}</li>
          <li>{t("On the watch, open System → Pair Phone, then connect from the iPhone.")}</li>
        </ol>
        <p className="watch-link-phone-warning">
          <ShieldAlert size={14} aria-hidden="true" />{t("The code contains your COROS watch key. Anyone who scans or photographs it can authenticate with your watch, even after it hides. Show it only to your own phone.")}</p>
        {error ? <p className="watch-link-note is-error" role="alert">{t(error)}</p> : null}
        {!available ? <p className="watch-link-hint">{t("Restart CorosLink to enable iPhone pairing.")}</p> : null}
        <div className="watch-link-phone-actions">
          {pairing ? (
            <button className="secondary-button watch-link-button" type="button" onClick={() => setPairing(null)}>
              <EyeOff size={15} aria-hidden="true" />{" "}{t("Hide code")}</button>
          ) : (
            <button className="primary-button watch-link-button" type="button" disabled={busy || !available} onClick={() => void show()}>
              {busy ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <QrCode size={15} aria-hidden="true" />}{t("Show pairing code")}</button>
          )}
        </div>
      </div>
      <figure className={`watch-link-phone-code${pairing ? " is-visible" : ""}`} aria-live="polite">
        {pairing ? <>
          <img src={pairing.qrDataUrl} alt={t("Pairing code for C-LINK on iPhone")} width={260} height={260} />
          <figcaption>
            <span>{t("Account")}{" "}{pairing.account}{pairing.deviceName ? t(" · {{value1}}", { value1: pairing.deviceName.replace(/\s+[0-9A-F]{4,8}$/i, "") }) : ""}</span>
            <span className="watch-link-phone-timer">{t("Hides in")}{" "}{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</span>
          </figcaption>
        </> : <div className="watch-link-phone-placeholder" aria-hidden="true"><QrCode size={48} /></div>}
      </figure>
    </div>
  );
}
