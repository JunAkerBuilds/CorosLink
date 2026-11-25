// Whose data this window shows: the viewer of the store on this computer the app is signed in to. Never the token.
import { json, readAccount } from "@/server/local/http";

export async function GET(): Promise<Response> {
  const account = await readAccount();
  return json({ viewer: account?.viewer ?? null });
}
