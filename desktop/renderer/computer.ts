// What to call the computer C-LINK runs on, for "this Mac" / "this PC" in the words on screen.
import { t } from "@/lib/i18n";

export type Computer = "Mac" | "PC" | "computer";

/** "Mac" on macOS, "PC" on Windows, "computer" anywhere else (Linux, or no browser at all). */
export function computerFrom(userAgent: string | undefined): Computer {
  if (!userAgent) return "computer";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "PC";
  return "computer";
}

export const COMPUTER: Computer = computerFrom(typeof navigator === "undefined" ? undefined : navigator.userAgent);

/** The computer's name for a line on screen ("this {computer}"): Mac and PC as they are, "computer" translated. */
export const computerWord = (computer: Computer = COMPUTER): string => (computer === "computer" ? t("computer") : computer);

/** "This Mac", "This PC" or "This computer", in the app's language. */
export const thisComputer = (computer: Computer = COMPUTER): string => t("This {computer}", { computer: computerWord(computer) });
