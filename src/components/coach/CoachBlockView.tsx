"use client";
import { useEffect, useState } from "react";
import { latestCard, onCardChanged, type CoachBlock } from "@/data/coach";
import { Brief, Failed, Note, PlanChange, Question, Working, Workout } from "./ActionCards";
import { Compare, Debrief, Fuel, PlanCheck, Recap, Today, Trend } from "./AnswerCards";
import { PlanDraft, PlanEdit } from "./PlanCards";

/** One piece of a Coach reply: a paragraph, a card, or a small note line. */
export function CoachBlockView({ block: given }: { block: CoachBlock }) {
  const block = useLatest(given);
  switch (block.kind) {
    case "text": return <p>{block.text}</p>;
    case "recap": return <Recap card={block} />;
    case "compare": return <Compare card={block} />;
    case "fuel": return <Fuel card={block} />;
    case "trend": return <Trend card={block} />;
    case "today": return <Today card={block} />;
    case "plancheck": return <PlanCheck card={block} />;
    case "debrief": return <Debrief card={block} />;
    case "plan": return <PlanChange card={block} />;
    case "planEdit": return <PlanEdit card={block} />;
    case "planDraft": return <PlanDraft card={block} />;
    case "workout": return <Workout card={block} />;
    case "question": return <Question card={block} />;
    case "brief": return <Brief card={block} />;
    case "working": return <Working card={block} />;
    case "failed": return <Failed card={block} />;
    case "note": return <Note line={block} />;
  }
}

/** The card with any change a button made since it was read (see latestCard in data/coach). */
function useLatest(block: CoachBlock): CoachBlock {
  const [, bump] = useState(0);
  const id = block.kind === "text" ? null : block.id;
  useEffect(() => (id ? onCardChanged((b) => { if (b.kind !== "text" && b.id === id) bump((n) => n + 1); }) : undefined), [id]);
  return latestCard(block);
}
