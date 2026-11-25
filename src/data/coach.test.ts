import { describe, expect, it } from "vitest";
import { conversationsFrom, groupOf, messageItemId, stampOf } from "./coach";
import { dateToRef } from "./sync/native";

const NOW = new Date(2026, 10, 20, 14, 10);
const ref = (d: number, h: number) => dateToRef(new Date(2026, 10, d, h, 5));

describe("Coach conversations from the account", () => {
  it("orders messages by their number and conversations by their last change", () => {
    const list = conversationsFrom(
      [
        { id: "A", body: { title: "Tempo", startedAt: ref(12, 9), updatedAt: ref(12, 9) } },
        { id: "B", body: { title: "Today", startedAt: ref(20, 9), updatedAt: ref(20, 9), suggestions: ["Next?"], sources: [{ title: "Health", detail: "Today", href: "/health" }] } },
        { id: "C", body: { title: "Empty", startedAt: ref(20, 10), updatedAt: ref(20, 10) } },
      ],
      [
        { id: messageItemId("B", 1), body: { conversationId: "B", n: 1, at: 0, message: { id: "b2", from: "coach", blocks: [{ kind: "text", text: "Fine." }] } } },
        { id: messageItemId("B", 0), body: { conversationId: "B", n: 0, at: 0, message: { id: "b1", from: "you", text: "How is today?" } } },
        { id: messageItemId("A", 0), body: { conversationId: "A", n: 0, at: 0, message: { id: "a1", from: "you", text: "Tempo?" } } },
        { id: "junk", body: { conversationId: "A", n: 1, at: 0, message: { nope: true } } },
      ],
      NOW,
    );
    expect(list.map((c) => [c.id, c.group, c.stamp])).toEqual([["B", "Today", "09:05"], ["A", "Earlier", "12 Nov"]]);
    expect(list[0].messages.map((m) => m.id)).toEqual(["b1", "b2"]);
    expect(list[0].suggestions).toEqual(["Next?"]);
    expect(list[1].messages).toHaveLength(1);
  });
  it("groups by how many days ago and writes item ids that sort", () => {
    expect(groupOf(new Date(2026, 10, 17, 23).getTime(), NOW)).toBe("This week");
    expect(stampOf(new Date(2026, 10, 20, 7, 3).getTime(), NOW)).toBe("07:03");
    expect(messageItemId("ABC", 7)).toBe("ABC.0007");
  });
});
