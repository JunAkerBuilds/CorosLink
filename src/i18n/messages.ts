import { t } from "./locale";

export type LocalizableText = string | { readonly render: () => string | null | undefined };

/** Keep the source and interpolation in state, so feedback follows later language changes. */
export function localizedText(render: () => string | null | undefined): LocalizableText {
  return { render };
}

export function renderLocalizedText(message: LocalizableText): string {
  return t(typeof message === "string" ? message : message.render() ?? "");
}
