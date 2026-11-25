// Which AI Coach answers with: the athlete's pick in Coach settings (desktop/main/ai), or the scripted dev model with
// COACH_MODEL=mock. Nothing about the key itself comes back out of this route.
import { json, notReady, readAccount } from "@/server/local/http";
import { usingMockModel } from "@/server/coach/access";
import { MOCK_NOTE } from "@/server/coach/mockModel";
import { hostAI } from "@/server/ai/host";

export async function GET(): Promise<Response> {
  if (!(await readAccount())) return notReady();
  const host = await hostAI.current?.model();
  if (host) return json({ key: "own", model: host.label });
  return json(usingMockModel() ? { key: "mock", model: MOCK_NOTE } : { key: "none", model: "" });
}
