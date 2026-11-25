// `next/link` for the desktop app: an <a> that moves the in-app router instead of loading a page.
import type { AnchorHTMLAttributes, MouseEvent, Ref } from "react";
import { navigate, type Href, hrefText } from "../renderer/router";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
  ref?: Ref<HTMLAnchorElement>;
}

export default function Link({ href, replace, scroll, prefetch, onClick, ref, ...rest }: LinkProps) {
  void prefetch;
  const to = hrefText(href);
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    if (!to.startsWith("/") || to.startsWith("/api/")) return;
    e.preventDefault();
    navigate(to, { replace, scroll });
  };
  return <a ref={ref} href={to} onClick={go} {...rest} />;
}
