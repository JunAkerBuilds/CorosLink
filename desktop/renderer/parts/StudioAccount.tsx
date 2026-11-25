// Studio's COROS account: the chip on the home page's title row and the sign-in it opens. The password goes to the
// main process once and is never kept on the page; the main process keeps only the session and, when asked, the
// password's digest (desktop/main/watchface/corosAccount.ts).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, Select } from "@/components/ui";
import { Icon } from "./StudioIcon";
import { corosForget, corosSignIn, corosSignInSaved, corosSignOut, said, type AccountStatus, type CorosRegion } from "../studio";

const REGIONS: { value: CorosRegion; label: string }[] = [
  { value: "us", label: "Americas" }, { value: "eu", label: "Europe" }, { value: "sg", label: "Asia-Pacific" }, { value: "cn", label: "China" },
];
export const regionName = (r?: CorosRegion) => REGIONS.find((x) => x.value === r)?.label ?? "";

export function AccountChip({ account, onOpen }: { account: AccountStatus | null; onOpen: () => void }) {
  return (
    <button type="button" className="st-account-chip" onClick={onOpen} aria-haspopup="dialog" title={account?.signedIn ? account.email : "Sign in to COROS"}>
      <span className="st-account-icon"><Icon name="user" size={15} /></span>COROS account
      <i data-on={account?.signedIn ? "" : undefined} aria-label={account?.signedIn ? "Signed in" : "Signed out"} />
    </button>
  );
}

/** Sign in, or who is signed in and signing out. */
export function AccountDialog({ account, onClose, onChange }: { account: AccountStatus; onClose: () => void; onChange: (a: AccountStatus) => void }) {
  const [region, setRegion] = useState<CorosRegion>(account.region ?? account.suggestedRegion);
  const [email, setEmail] = useState(account.savedEmail ?? "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(account.savedEmail) || account.canSave);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, button:not(.st-icon-btn)")?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  const act = async (work: () => Promise<AccountStatus>, close = false) => {
    setBusy(true); setProblem(null);
    try { const next = await work(); onChange(next); setPassword(""); if (close && next.signedIn) onClose(); } catch (e) { setProblem(said(e)); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void act(() => corosSignIn({ email, password, region, remember: remember && account.canSave }), true); };

  return (
    <div className="st-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="st-dialog st-small-dialog pop" role="dialog" aria-modal="true" aria-label="COROS account">
        <div className="st-dialog-head"><h2>COROS account</h2><button type="button" className="st-icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        {account.signedIn ? (
          <div className="st-dialog-stack">
            <div className="st-account-who"><span className="st-account-icon big"><Icon name="user" size={20} /></span>
              <span><b>{account.email}</b><small>{regionName(account.region)}{account.savedEmail ? " · saved on this computer" : ""}</small></span></div>
            {problem ? <div className="notice" role="alert">{problem}</div> : null}
            <div className="st-dialog-actions">
              {account.savedEmail ? <Button disabled={busy} onClick={() => void act(corosForget)}>Forget saved account</Button> : null}
              <Button variant="primary" disabled={busy} onClick={() => void act(corosSignOut)}>Sign out</Button>
            </div>
          </div>
        ) : (
          <form className="st-dialog-stack" onSubmit={submit}>
            <p className="st-note">For COROS&apos;s official faces, the faces saved to your account and its full template list.</p>
            <label className="st-form-row"><span>Region</span>
              <Select field value={region} onChange={(e) => setRegion(e.target.value as CorosRegion)}>{REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></label>
            {account.savedEmail ? (
              <Button variant="primary" className="st-wide" disabled={busy} onClick={() => void act(() => corosSignInSaved(region), true)}>Sign in as {account.savedEmail}</Button>
            ) : null}
            <label className="st-form-row"><span>Email</span><Field type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="st-form-row"><span>Password</span><Field type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <label className="st-check" title={account.canSave ? undefined : "This computer has no keychain to keep it in."}>
              <input type="checkbox" checked={remember && account.canSave} disabled={!account.canSave} onChange={(e) => setRemember(e.target.checked)} />Save this COROS account
            </label>
            {problem ? <div className="notice" role="alert">{problem}</div> : null}
            <div className="st-dialog-actions">
              <Button type="submit" variant={account.savedEmail ? "glass" : "primary"} disabled={busy || !email || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
