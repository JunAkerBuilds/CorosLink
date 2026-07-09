"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { GitHubLink } from "./GitHubLink";

const LINKS = [
  { href: "#overview", label: "Overview" },
  { href: "#music", label: "Music" },
  { href: "#maps", label: "Maps" },
  { href: "#training", label: "Training" },
  { href: "#faq", label: "FAQ" },
  { href: "#download", label: "Download" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "border-b border-white/10 bg-base/70 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-[120rem] items-center justify-between px-6 lg:px-12">
        <a href="#top" className="flex items-center gap-2.5">
          <Image
            src="/icon.png"
            alt="CorosLink"
            width={30}
            height={30}
            className="rounded-lg"
          />
          <span className="text-[15px] font-semibold tracking-tight">CorosLink</span>
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3.5 py-2 text-sm text-muted transition-colors hover:text-text"
            >
              {link.label}
            </a>
          ))}
        </div>

        <GitHubLink variant="nav" />
      </nav>
    </header>
  );
}
