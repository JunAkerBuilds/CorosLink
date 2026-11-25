// How much data the store on this computer holds, and its cursor.
import { forward } from "@/server/local/http";

export async function GET(): Promise<Response> {
  return forward("/api/v1/me/sync/status");
}
