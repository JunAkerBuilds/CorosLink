import Image from "next/image";

const GITHUB_URL = "https://github.com/JunAkerBuilds/CorosLink";
const BUY_ME_A_COFFEE_URL = "https://www.buymeacoffee.com/addridoa";
const BUY_ME_A_COFFEE_IMAGE =
  "https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=&slug=addridoa&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="footer-brand">
          <Image src="/icon.png" alt="" width={28} height={28} />
          CorosLink
        </div>
        <div className="footer-links">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="#features">Features</a>
          <a href="#download">Download</a>
        </div>
        <a
          className="footer-support"
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy me a coffee"
        >
          <img src={BUY_ME_A_COFFEE_IMAGE} alt="Buy me a coffee" />
        </a>
        <p className="footer-disclaimer">
          CorosLink is an unofficial app for COROS Pace Pro owners. Not
          affiliated with or endorsed by COROS. COROS is a trademark of COROS
          Wearables Inc.
        </p>
      </div>
    </footer>
  );
}
