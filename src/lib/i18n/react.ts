// `t` for lines with markup inside: `tr("Plug in {watch} now", { watch: <b>your watch</b> })`.
import { createElement, Fragment, type ReactNode } from "react";
import { t } from "./index";

/** The English `text` in the app's language, with each `{name}` replaced by `parts[name]` (text or elements). */
export function tr(text: string, parts: Readonly<Record<string, ReactNode>>): ReactNode {
  const pieces = t(text).split(/\{(\w+)\}/);
  // split keeps the names at the odd places.
  const children = pieces.map((piece, i) => (i % 2 === 0 ? piece : piece in parts ? parts[piece] : `{${piece}}`));
  return createElement(Fragment, null, ...children);
}
