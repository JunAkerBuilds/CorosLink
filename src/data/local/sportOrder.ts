"use client";
import { createStore, useStore } from "./store";

/** The order the person dragged their sports into on the Sports switcher. Saved on this computer only. */
export const sportOrderStore = createStore<string[]>("sports.order", []);
const NONE: string[] = [];

/** The saved order, live. Empty until the person drags a tab. */
export const useSportOrder = (): string[] => useStore(sportOrderStore, NONE);
