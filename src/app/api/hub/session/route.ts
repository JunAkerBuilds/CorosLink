// The COROS Training Hub sign-in for this browser.
import { HubExpired } from "@/server/hub/errors";
import { clearSession, hub, hubRoute, readBody, readPending, readSession, sessionInfo, shareSession, writePending, writeSession } from "@/server/hub/http";
import { account, passwordHash } from "@/server/hub/validate";
import type { HubSessionInfo } from "@/data/hub";

/** Who is signed in. With `?verify=1` COROS is asked whether it still takes the session. Never the token. */
export const GET = hubRoute({}, async (request): Promise<HubSessionInfo> => {
  const stored = await readSession();
  if (stored) {
    if (request.nextUrl.searchParams.get("verify") === "1") {
      try {
        await hub.check(stored.session);
      } catch (error) {
        if (!(error instanceof HubExpired)) throw error;
        await clearSession();
        return { state: "ended", email: stored.email };
      }
    }
    return sessionInfo(stored);
  }
  const pending = await readPending();
  if (pending) return { state: "needsCode", email: pending.email, codeSentTo: pending.challenge.account };
  return { state: "signedOut" };
});

/**
 * Signs in with `{ email, passwordHash }`, the hash being the password's MD5 worked out in the browser. The
 * server bcrypts it with a fresh salt for COROS, as COROS's own web sign-in does, and keeps neither.
 */
export const POST = hubRoute({ write: true, signingIn: true }, async (request): Promise<HubSessionInfo> => {
  const body = await readBody(request);
  const email = account(body.email);
  const hash = passwordHash(body.passwordHash);
  await clearSession();
  const result = await hub.signIn(email, hash);
  if (result.kind === "signedIn") {
    const stored = { session: result.session, email };
    await writeSession(stored);
    await shareSession(stored);
    return sessionInfo(stored);
  }
  await writePending({ challenge: result.challenge, email });
  return { state: "needsCode", email, codeSentTo: result.challenge.account };
});

/**
 * Signs out: the cookies go, and so does the shared copy, which signs the person's phone out too.
 * (COROS has no sign-out request in the phone app either.)
 */
export const DELETE = hubRoute({ write: true }, async (): Promise<HubSessionInfo> => {
  await clearSession();
  await shareSession(null);
  return { state: "signedOut" };
});
