"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import "./dialog.css";

/**
 * A modal dialog on the browser's own <dialog>: focus stays inside it, Escape closes it, and focus goes back
 * to the control that opened it. `children` get a `close` to call from their own buttons.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: (close: () => void) => ReactNode }) {
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    if (!el || el.open) return;
    el.showModal();
    el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [el]);
  // Closing through the element fires its close event, which is what tells the page; that way Escape,
  // the backdrop and the buttons all take one path and the browser hands focus back.
  const close = () => {
    if (el?.open) el.close(); else onClose();
  };
  return (
    <dialog
      ref={setEl}
      className="dlg"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="dlg-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="dlg-x" aria-label={t("Close")} onClick={close}>×</button>
      </div>
      <div className="dlg-body">{children(close)}</div>
    </dialog>
  );
}
