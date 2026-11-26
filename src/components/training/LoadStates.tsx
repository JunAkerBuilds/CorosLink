"use client";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";

/** Placeholder while a screen's data loads. */
export function LoadingPage({ label }: { label: string }) {
  return (
    <main className="page" aria-busy="true" aria-label={label}>
      <div className="skeleton" />
    </main>
  );
}

/** A loader failed: say what it said, and offer another go. */
export function LoadError({ error, onRetry, children }: { error: Error; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <main className="page">
      <div className="notice" role="alert">
        <span style={{ flex: "1 1 240px" }}>{error.message}</span>
        {children}
        {onRetry ? <Button onClick={onRetry}>{t("Try again")}</Button> : null}
      </div>
    </main>
  );
}
