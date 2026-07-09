import Image from "next/image";
import { Heart } from "lucide-react";
import { BuyMeCoffee } from "./BuyMeCoffee";
import { GitHubLink } from "./GitHubLink";
import { GitHubStarCount } from "./GitHubStarCount";

const LINK_GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Overview", href: "#overview" },
      { label: "Music", href: "#music" },
      { label: "Maps & routes", href: "#maps" },
      { label: "Training", href: "#training" },
      { label: "FAQ", href: "#faq" },
      { label: "Download", href: "#download" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/JunAkerBuilds/CorosLink" },
      { label: "Releases", href: "https://github.com/JunAkerBuilds/CorosLink/releases" },
      { label: "Report an issue", href: "https://github.com/JunAkerBuilds/CorosLink/issues" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Buy me a coffee", href: "https://www.buymeacoffee.com/addridoa" },
      { label: "GitHub Sponsors", href: "https://github.com/sponsors/JunAkerBuilds" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-white/10 px-5 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-16 lg:px-12">
      <div className="mx-auto max-w-[120rem]">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)] md:gap-12">
          <div>
            <div className="flex items-center gap-2.5">
              <Image src="/icon.png" alt="CorosLink" width={30} height={30} className="rounded-lg" />
              <span className="text-[15px] font-semibold">CorosLink</span>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              An open-source, local-first desktop companion for COROS watch owners.
              Music, maps, routes, and training — all in one place.
            </p>
            <div className="mt-5 flex items-center gap-3">
              <GitHubLink variant="footer" />
              <BuyMeCoffee variant="footer" />
            </div>
            <GitHubStarCount />
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-9 sm:grid-cols-3">
            {LINK_GROUPS.map((group, index) => (
              <div key={group.title} className={index === 0 ? "col-span-2 sm:col-span-1" : ""}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-quiet">
                  {group.title}
                </h3>
                <ul
                  className={
                    index === 0
                      ? "mt-4 grid grid-cols-2 gap-x-6 gap-y-2.5 sm:block sm:space-y-2.5"
                      : "mt-4 space-y-2.5"
                  }
                >
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={link.href.startsWith("http") ? "_blank" : undefined}
                        rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="block py-0.5 text-sm text-muted transition-colors hover:text-text"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-6 text-xs leading-relaxed text-quiet sm:mt-12 sm:flex-row sm:items-center">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            Built with <Heart size={12} className="text-accent" /> by CorosLink contributors
          </p>
          <p className="max-w-md sm:text-right">
            COROS is a trademark of its respective owner. CorosLink is unofficial and
            not affiliated with or endorsed by COROS.
          </p>
        </div>
      </div>
    </footer>
  );
}
