// The public Mapbox token the activity map asks for its tiles with. It is a `pk.` token, made to be seen by
// browsers, but it is kept out of the code. Set it as MAPBOX_TOKEN in the environment.
import { json, notReady, readAccount } from "@/server/local/http";

export async function GET(): Promise<Response> {
  if (!(await readAccount())) return notReady();
  const token = process.env.MAPBOX_TOKEN?.trim();
  // Only a public token ever leaves the main process: a secret `sk.` one set by mistake is treated as none.
  return json({ token: token && token.startsWith("pk.") ? token : null });
}
