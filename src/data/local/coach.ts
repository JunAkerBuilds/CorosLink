"use client";
import { createStore } from "./store";

/** A message typed here. Coach has not answered it: there is no Coach server for the web yet. */
export interface OwnMessage {
  id: string;
  conversationId: string;
  text: string;
  at: number;
  /** "sending" until the data layer answers; "not-connected" once it said there is no server. */
  state: "sending" | "not-connected";
}

/** A conversation started here. */
export interface OwnConversation {
  id: string;
  title: string;
  at: number;
}

export interface CoachSaved {
  conversations: OwnConversation[];
  messages: OwnMessage[];
}

export const COACH_EMPTY: CoachSaved = { conversations: [], messages: [] };
export const NEW_TITLE = "New conversation";

export const coachStore = createStore<CoachSaved>("coach.v1", COACH_EMPTY);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Starts an empty conversation and returns its id. */
export function startConversation(): string {
  const id = newId(), at = Date.now();
  coachStore.set((s) => ({ ...s, conversations: [{ id, title: NEW_TITLE, at }, ...s.conversations] }));
  return id;
}

/** Saves a typed message and returns its id. The first message of a conversation started here becomes its title. */
export function saveOwnMessage(conversationId: string, text: string): string {
  const message: OwnMessage = { id: newId(), conversationId, text, at: Date.now(), state: "sending" };
  coachStore.set((s) => ({
    conversations: s.conversations.map((c) =>
      c.id === message.conversationId && c.title === NEW_TITLE ? { ...c, title: titleFrom(message.text) } : c,
    ),
    messages: [...s.messages, message],
  }));
  return message.id;
}

export function markNotConnected(id: string): void {
  coachStore.set((s) => ({ ...s, messages: s.messages.map((m) => (m.id === id ? { ...m, state: "not-connected" } : m)) }));
}

export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0].trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/**
 * What the person did to Coach's cards at this desk: which are folded, which plan changes they chose to keep
 * as they were, and what they answered. None of this reaches Coach until the web has a Coach server.
 */
export interface CardChoices {
  /** Card id to folded or not, only where it differs from how the card arrives. */
  folded: Record<string, boolean>;
  kept: Record<string, boolean>;
  answers: Record<string, { optionId?: string; text?: string; at: number }>;
}

export const CARDS_EMPTY: CardChoices = { folded: {}, kept: {}, answers: {} };
export const cardStore = createStore<CardChoices>("coach.cards.v1", CARDS_EMPTY);

const clean = (c: CardChoices | undefined): CardChoices => ({ folded: c?.folded ?? {}, kept: c?.kept ?? {}, answers: c?.answers ?? {} });

export function setFolded(id: string, folded: boolean): void {
  cardStore.set((c) => ({ ...clean(c), folded: { ...clean(c).folded, [id]: folded } }));
}

export function setKept(id: string, kept: boolean): void {
  cardStore.set((c) => ({ ...clean(c), kept: { ...clean(c).kept, [id]: kept } }));
}

export function saveAnswer(id: string, answer: { optionId?: string; text?: string }): void {
  cardStore.set((c) => ({ ...clean(c), answers: { ...clean(c).answers, [id]: { ...answer, at: Date.now() } } }));
}

export function clearAnswer(id: string): void {
  cardStore.set((c) => {
    const answers = { ...clean(c).answers };
    delete answers[id];
    return { ...clean(c), answers };
  });
}
