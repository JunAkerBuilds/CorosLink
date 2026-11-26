// Status words the phone sends in English (training load, form, readiness). Screens show them through t(), so they
// read in the app's language; listed here so the catalog check asks for them.
import { msg } from "@/lib/i18n";

export const PHONE_STATUS_WORDS = [
  msg("Optimized"), msg("Productive"), msg("Maintaining"), msg("Recovering"), msg("Overreaching"), msg("Detraining"),
  msg("Peaking"), msg("Ready"), msg("Fresh"), msg("Strained"), msg("Low"), msg("High"),
] as const;
