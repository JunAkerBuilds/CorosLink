import crypto from "node:crypto";
import type { CoachReviewAction, CoachReviewItem, CoachReviewPreview } from "./coachReviewTypes";

// Staged Coach writes and their approval. The Coach's tool stages a change and
// gets "awaiting_confirmation"; only the card's button (the athlete) runs it.
// Reviews survive a restart; one interrupted mid-save is reported, not retried.

const REVIEW_TTL = 24 * 60 * 60_000;
const MAX_REVIEWS = 100;

interface StoredReview {
  preview: CoachReviewPreview;
  payload: unknown;
  /** Staged by Claude Code, whose permission switches still apply at approval. */
  claude: boolean;
}

/** What running a change did, item by item in the preview's order. */
export interface CoachReviewOutcome {
  results: Array<{ ok: boolean; message?: string }>;
  message?: string;
}

/** Thrown by an executor that changed nothing, so the card offers its button again. */
export class CoachReviewNotSentError extends Error {
  readonly notSent = true;
}

export interface CoachReviewDependencies {
  load: () => string | undefined;
  save: (value: string) => void;
  execute: (action: CoachReviewAction, payload: unknown, preview: CoachReviewPreview) => Promise<CoachReviewOutcome>;
  /** False when the switch that allowed this change was turned off since it was staged. */
  canConfirm: (action: CoachReviewAction, claude: boolean) => boolean;
  now?: () => number;
}

export interface CoachReviewDraft {
  action: CoachReviewAction;
  title: string;
  summary: string;
  items: CoachReviewItem[];
  notes?: string[];
  payload: unknown;
}

export function createCoachReviewService(deps: CoachReviewDependencies) {
  const now = deps.now ?? Date.now;
  let reviews: StoredReview[] | undefined;
  const active = new Set<string>();
  const load = () => {
    if (!reviews) {
      try { reviews = JSON.parse(deps.load() ?? "[]") as StoredReview[]; } catch { reviews = []; }
      if (!Array.isArray(reviews)) reviews = [];
    }
    return reviews;
  };
  const persist = () => deps.save(JSON.stringify(load()));
  const find = (requestId: string) => {
    const review = load().find((item) => item.preview.requestId === requestId);
    if (!review) throw new Error("This review expired. Ask the coach to prepare it again.");
    if (review.preview.state === "saving" && !active.has(requestId)) {
      review.preview.state = "failed";
      review.preview.message = "The save was interrupted. Check the result before asking the coach again.";
      persist();
    }
    return review;
  };

  return {
    stage(draft: CoachReviewDraft, claude = false): CoachReviewPreview {
      if (!draft.summary.trim()) throw new Error("Provide a plain-language review_summary for the athlete.");
      if (!draft.items.length) throw new Error("There is nothing to change.");
      const preview: CoachReviewPreview = {
        requestId: crypto.randomUUID(),
        action: draft.action,
        title: draft.title,
        summary: draft.summary.trim(),
        items: draft.items.map((item) => ({ ...item })),
        ...(draft.notes?.length ? { notes: [...draft.notes] } : {}),
        createdAt: now(),
        state: "pending"
      };
      reviews = load()
        .filter((item) => now() - item.preview.createdAt < REVIEW_TTL || active.has(item.preview.requestId))
        .slice(-(MAX_REVIEWS - 1));
      reviews.push({ preview, payload: structuredClone(draft.payload), claude });
      persist();
      return structuredClone(preview);
    },

    get(requestId: string): CoachReviewPreview {
      return structuredClone(find(requestId).preview);
    },

    async confirm(requestId: string): Promise<CoachReviewPreview> {
      const review = find(requestId);
      if (active.has(requestId)) throw new Error("This change is already being saved.");
      if (review.preview.state !== "pending") return structuredClone(review.preview);
      if (now() - review.preview.createdAt > REVIEW_TTL) throw new Error("This review expired. Ask the coach to prepare it again.");
      if (!deps.canConfirm(review.preview.action, review.claude)) throw new Error("This change is turned off in Coach settings.");
      active.add(requestId);
      review.preview.state = "saving";
      persist(); // Record the dispatch before anything changes, across restarts too.
      try {
        const outcome = await deps.execute(review.preview.action, review.payload, structuredClone(review.preview));
        const done = outcome.results.filter((result) => result.ok).length;
        review.preview.items = review.preview.items.map((item, index) => ({
          ...item,
          result: outcome.results[index] ?? { ok: false, message: "Not attempted." }
        }));
        review.preview.state = done === review.preview.items.length ? "saved" : done > 0 ? "partial" : "failed";
        if (outcome.message) review.preview.message = outcome.message;
      } catch (error) {
        if ((error as { notSent?: unknown } | null)?.notSent === true) {
          review.preview.state = "pending";
          persist();
          throw error;
        }
        review.preview.state = "failed";
        review.preview.message = error instanceof Error ? error.message : "The change couldn't be saved.";
      } finally {
        active.delete(requestId);
      }
      persist();
      return structuredClone(review.preview);
    },

    dismiss(requestId: string): CoachReviewPreview {
      const review = find(requestId);
      if (active.has(requestId) || review.preview.state === "saving") throw new Error("This change is already being saved.");
      if (review.preview.state === "pending") {
        review.preview.state = "dismissed";
        persist();
      }
      return structuredClone(review.preview);
    }
  };
}

export type CoachReviewService = ReturnType<typeof createCoachReviewService>;
