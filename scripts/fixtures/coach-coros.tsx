import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CorosActionCard } from "../../src/chat/CorosActionCard";
import { fromPersistedEntries, toPersistedEntries, toWireMessages, upsertCorosActionEntry } from "../../src/chat/chatTypes";
import type { ChatEntry } from "../../src/chat/chatTypes";
import type { CoachCorosActionPreview } from "../../electron/types";
import "../../src/styles.css";

// Default visual fixture uses simulated saves. The test-only session mode below uses isolated IPC.
const pending: CoachCorosActionPreview = {
  requestId: "fixture-review", title: "Review workout", summary: "Add an easy run to tomorrow's calendar.",
  destination: "Calendar", date: "20260922", state: "pending", createdAt: Date.now(),
  details: ["Run · Easy aerobic run", "Warm-up: 10 min · Heart rate zone 1", "4 × (Training: 1.00 km · Pace: 6:00–6:30 /km; Recovery: 1:30 · No intensity target)", "Cool-down: Open · No intensity target"]
};
function Fixture() {
  const [count, setCount] = useState(0);
  const [message, setMessage] = useState("");
  return <main className="chat-view" style={{ maxWidth: 680, padding: 32, margin: "auto", display: "grid", gap: 20, height: "auto" }}>
    <h2>Coach workout review</h2>
    <p>Isolated preview · simulated saves: {count}</p>
    <CorosActionCard preview={pending} onConfirm={async () => {
      setCount(n => n + 1);
      await new Promise(resolve => setTimeout(resolve, 1200));
      const saved = { ...pending, state: "saved" as const, message: "COROS accepted the change. The saved item is available to read." };
      const timeline = upsertCorosActionEntry(upsertCorosActionEntry([], pending), saved);
      const restored = fromPersistedEntries(toPersistedEntries(timeline));
      if (restored.length !== 1 || !toWireMessages(restored)[0].content.includes("saved")) throw new Error("History round-trip failed");
      setMessage("History round-trip and Coach context passed.");
      return saved;
    }} />
    <p role="status">{message}</p>
    <CorosActionCard preview={{ ...pending, requestId: "fixture-uncertain", state: "uncertain", message: "COROS did not confirm the save. Check the destination before trying again to avoid a duplicate." }} onConfirm={async () => { throw new Error("An uncertain save must not be retried"); }} />
    <CorosActionCard preview={{ ...pending, requestId: "fixture-error", title: "Review workout changes" }} onConfirm={async () => { throw new Error("This workout changed since the preview. Ask the coach to read it again before editing or scheduling it."); }} />
  </main>;
}
// The Electron integration test supplies the real preload and an isolated local session.
function ServiceFixture({ sessionId }: { sessionId: string }) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  useEffect(() => {
    void window.corosLink!.getChatSession(sessionId).then(saved => setEntries(fromPersistedEntries(saved)));
  }, [sessionId]);
  return <main className="chat-view" style={{ maxWidth: 680, padding: 32, margin: "auto", display: "grid", gap: 20, height: "auto" }}>
    <h2>Coach workout review</h2>
    {entries.map(entry => entry.kind === "corosAction" && <section key={entry.preview.requestId} data-action={entry.preview.requestId}>
      <CorosActionCard preview={entry.preview} onConfirm={async () => {
        const saved = await window.corosLink!.confirmCorosAction(entry.preview.requestId);
        const next = upsertCorosActionEntry(entries, saved);
        await window.corosLink!.saveChatSession(sessionId, toPersistedEntries(next));
        setEntries(next);
        return saved;
      }} />
    </section>)}
    <pre data-testid="coach-context">{JSON.stringify(toWireMessages(entries))}</pre>
  </main>;
}
const sessionId = new URLSearchParams(location.search).get("session");
createRoot(document.getElementById("root")!).render(sessionId ? <ServiceFixture sessionId={sessionId} /> : <Fixture />);
