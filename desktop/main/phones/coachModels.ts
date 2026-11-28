// The AI choices a phone's Coach model picker shows (CoachModelCatalog): the providers set up on the AI page, each
// with its model and the models it offers. Picking one there is the same as picking it on the AI page.
import type { AIService } from "../ai/service";
import type { CoachModels } from "./socket";

const ask = async (ai: AIService, path: string, init?: { body: object }): Promise<Record<string, unknown>> => {
  const response = await ai.answer(new Request(`clink://app/api/desktop/ai/${path}`, init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : undefined));
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "That didn't work.");
  return body;
};

export function coachModels(ai: AIService): CoachModels {
  return {
    async catalog() {
      const status = await ai.status();
      const ready = status.providers.filter((p) => p.ready);
      const providers = await Promise.all(ready.map(async (p) => {
        // A provider that is slow to list its models still shows the one it uses.
        const listed = await Promise.race([
          ask(ai, `models?provider=${encodeURIComponent(p.id)}`).then((b) => (Array.isArray(b.models) ? b.models.filter((m): m is string => typeof m === "string") : []), () => []),
          new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 4000)),
        ]);
        const models = [...new Set([p.model, ...listed].filter((m) => m !== undefined))].slice(0, 60);
        return { id: p.id, label: p.name, model: p.model, models: models.map((value) => ({ value, label: value || "Default" })) };
      }));
      return { provider: status.picked ?? "", providers };
    },
    async choose(provider, model) {
      await ask(ai, "pick", { body: { provider, model } });
    },
  };
}
