// The top of Connections on the desktop: this computer, which keeps everything, and the phones that sync to it.
// Pairing shows a code C-LINK scans (Settings → Computers), valid once for ten minutes.
import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/components/ui";
// It sits in the Connections page's profile card and uses that page's styles; it brings them where it is reused.
import "@/app/(app)/connect/connect.css";
import "./thisComputer.css";
import { language, locale, t } from "@/lib/i18n";
import { FirewallNote, type FirewallState } from "./FirewallNote";
import { ReachAnywhere } from "./ReachAnywhere";

interface Phone { id: string; label: string; createdAt: string; lastUsedAt: string }
interface Status { name: string; listening: boolean; addresses: string[]; items: number; pairing: boolean; phones: Phone[]; firewall?: FirewallState }
interface Pairing { link: string; qr: string; expiresAt: string; /** When the code was asked for, on this computer's clock. */ startedAt: number }

const ago = (iso: string): string => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n} h ago", { n: hours });
  return new Date(iso).toLocaleDateString(language() === "en" ? undefined : locale(), { day: "numeric", month: "short" });
};

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const answer = await fetch(path, { cache: "no-store", ...init });
  const body = (await answer.json()) as T & { error?: { message: string } };
  if (!answer.ok) throw new Error(body.error?.message ?? t("That didn't work."));
  return body;
}

export function ThisComputer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const read = useCallback(() => ask<Status>("/api/desktop/phones").then(setStatus, (e: unknown) => setProblem(String(e))), []);
  useEffect(() => { void read(); }, [read]);
  // While a code is up: watch for the phone to pair, and count the code down.
  useEffect(() => {
    if (!pairing) return;
    const timer = setInterval(() => { setNow(Date.now()); void read(); }, 2000);
    return () => clearInterval(timer);
  }, [pairing, read]);
  // A phone paired since the code went up (a new one, or the same phone pairing again): the code has done its job.
  if (pairing && status?.phones.some((p) => Date.parse(p.createdAt) >= pairing.startedAt)) setPairing(null);

  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  if (pairing && left === 0) setPairing(null);

  const pair = () => {
    setProblem(null);
    const startedAt = Date.now();
    ask<Omit<Pairing, "startedAt">>("/api/desktop/phones/pair", { method: "POST" }).then((p) => { setNow(Date.now()); setPairing({ ...p, startedAt }); }, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  };
  const remove = (id: string) => { void ask(`/api/desktop/phones?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then(read); };

  return (
    <section className="cn-profile tc" aria-label={t("This computer")}>
      <span aria-hidden="true" className="cn-avatar tc-mark">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M3 5h18v11H3zM8 20h8M12 16v4" /></svg>
      </span>
      <div className="cn-who">
        <h1>{status?.name ?? t("This computer")}</h1>
        <span className="cn-who-line">
          <span className="cn-pill" data-tone="ok">{t("Stored here")}</span>
          {status ? <span>{status.items === 1 ? t("1 item") : t("{n} items", { n: status.items.toLocaleString(locale("en-GB")) })}</span> : null}
        </span>
      </div>
      <div className="cn-profile-actions">
        <Button variant="primary" onClick={pair} disabled={!!pairing}>{t("Pair a phone")}</Button>
      </div>

      {problem ? <p role="alert" className="cn-problem cn-wide">{problem}</p> : null}

      {pairing ? (
        <div className="tc-pair cn-wide" role="dialog" aria-label={t("Pair a phone")}>
          <div className="tc-qr" dangerouslySetInnerHTML={{ __html: pairing.qr }} />
          <div className="tc-steps">
            <h2>{t("Scan this with C-LINK")}</h2>
            <ol>
              <li>{t("Point your phone's camera at this code, or in C-LINK open Settings → Computers → Pair a computer.")}</li>
              <li>{t("Tap Pair on the phone.")}</li>
              <li>{t("Keep the phone on the same Wi-Fi as this computer.")}</li>
            </ol>
            <FirewallNote state={status?.firewall} />
            <span className="muted">{t("Works once · {time} left", { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}</span>
            <div className="tc-actions">
              <Button onClick={() => void navigator.clipboard.writeText(pairing.link)}>{t("Copy code")}</Button>
              <Button variant="plain" onClick={() => setPairing(null)}>{t("Cancel")}</Button>
            </div>
          </div>
        </div>
      ) : null}

      <Card className="cn-list tc-phones cn-wide" aria-label={t("Phones")}>
        <h3>{t("Phones")}{status?.phones.length ? <span className="tc-count">{status.phones.length}</span> : null}</h3>
        {status && status.phones.length === 0 ? <p className="cn-note">{t("No phone syncs here yet.")}</p> : null}
        {status?.phones.length ? (
          <ul>
            {status.phones.map((phone) => (
              <li key={phone.id}>
                <span className="cn-list-what">
                  <span aria-hidden="true" className="cn-mono" data-hue={status.listening ? "mint" : "grey"}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
                  </span>
                  <span><b>{phone.label}</b><small>{t("Synced {when}", { when: ago(phone.lastUsedAt) })}</small></span>
                </span>
                <button type="button" className="tc-remove" onClick={() => remove(phone.id)} aria-label={t("Remove {name}", { name: phone.label })}>{t("Remove")}</button>
              </li>
            ))}
          </ul>
        ) : null}
        {status && status.phones.length > 0 && !status.listening ? <p role="alert" className="cn-problem">{t("Phones can't reach this computer right now.")}</p> : null}
      </Card>
      <ReachAnywhere />
    </section>
  );
}
