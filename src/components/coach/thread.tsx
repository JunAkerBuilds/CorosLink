"use client";
import { createContext, useContext } from "react";

/** What a card needs from the conversation it sits in: which one it is, and a way to say something to Coach. */
export interface ThreadApi {
  conversationId: string;
  /** True while Coach is answering. */
  busy: boolean;
  send(text: string): void;
  /** Asks the last question again. */
  retry(): void;
  stop(): void;
}

export const ThreadContext = createContext<ThreadApi>({ conversationId: "", busy: false, send() {}, retry() {}, stop() {} });
export const useThread = (): ThreadApi => useContext(ThreadContext);
