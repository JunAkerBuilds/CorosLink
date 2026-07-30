import { Coffee } from "lucide-react";

const DONATE_URL = "https://www.buymeacoffee.com/addridoa";

export function DonateButton() {
  return (
    <a
      className="donate-button"
      href={DONATE_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Donate to support CorosLink"
      title="Buy me a coffee"
    >
      <span className="donate-button-art" aria-hidden="true">
        <Coffee className="donate-button-cup" size={17} strokeWidth={2.6} />
      </span>
      <span className="donate-button-label">Donate</span>
    </a>
  );
}
