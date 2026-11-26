// The 6-digit code COROS emails before it hands out a session.
import { HubInvalid } from "@/server/hub/errors";
import { hub, hubRoute, readBody, readPending, sessionInfo, shareSession, writeSession } from "@/server/hub/http";
import type { HubSessionInfo } from "@/data/hub";
import { t } from "@/lib/i18n";

async function pendingOrThrow() {
  const pending = await readPending();
  if (!pending) throw new HubInvalid(t("That sign-in ran out. Enter your email and password again."));
  return pending;
}

/** Finishes the sign-in with `{ code }`. */
export const POST = hubRoute({ write: true, signingIn: true }, async (request): Promise<HubSessionInfo> => {
  const body = await readBody(request);
  if (typeof body.code !== "string" || body.code.length > 16) throw new HubInvalid(t("Enter the 6-digit code COROS emailed you."));
  const pending = await pendingOrThrow();
  const stored = { session: await hub.verify(body.code, pending.challenge), email: pending.email };
  await writeSession(stored);
  await shareSession(stored);
  return sessionInfo(stored);
});

/** Asks COROS to email the code again. */
export const PUT = hubRoute({ write: true, signingIn: true }, async (): Promise<HubSessionInfo> => {
  const pending = await pendingOrThrow();
  await hub.sendCode(pending.challenge);
  return { state: "needsCode", email: pending.email, codeSentTo: pending.challenge.account };
});
