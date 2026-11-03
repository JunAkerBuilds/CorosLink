import assert from "node:assert/strict";
import { placeWatchfaceTourCard, watchfaceTourSpot, WATCHFACE_TOUR_GAP, WATCHFACE_TOUR_MARGIN } from "../src/watchfaces/watchfaceStudioTourLayout.ts";

const viewport = { width: 1600, height: 1000 };
const card = { width: 340, height: 200 };

// No target: the welcome card sits in the middle.
assert.deepEqual(placeWatchfaceTourCard(null, card, viewport, ["right"]), { x: 630, y: 400, placement: "center" });

// The first preferred side that fits wins, centered on the target and kept in the window.
const layers = { x: 4, y: 50, width: 258, height: 946 };
assert.deepEqual(placeWatchfaceTourCard(layers, card, viewport, ["right", "bottom"]),
  { x: 262 + WATCHFACE_TOUR_GAP, y: 423, placement: "right" });
const send = { x: 1438, y: 6, width: 156, height: 44 };
const sendCard = placeWatchfaceTourCard(send, card, viewport, ["bottom", "left"]);
assert.equal(sendCard.placement, "bottom");
assert.equal(sendCard.y, 50 + WATCHFACE_TOUR_GAP);
assert.equal(sendCard.x, viewport.width - WATCHFACE_TOUR_MARGIN - card.width, "slid left to stay on screen");

// A side without room is skipped: the dial in a narrow window takes the left.
const dial = { x: 403, y: 133, width: 526, height: 526 };
assert.equal(placeWatchfaceTourCard(dial, card, { width: 1100, height: 760 }, ["right", "left", "bottom"]).placement, "left");

// Nowhere to fit: centered rather than off screen.
const huge = { x: 20, y: 20, width: 1560, height: 960 };
assert.equal(placeWatchfaceTourCard(huge, card, viewport, ["right", "left", "bottom", "top"]).placement, "center");

// The spotlight grows by its padding but never leaves the window.
assert.deepEqual(watchfaceTourSpot({ x: 0, y: 2, width: 100, height: 40 }, viewport, 6), { x: 4, y: 4, width: 102, height: 44 });
assert.deepEqual(watchfaceTourSpot({ x: 1550, y: 980, width: 100, height: 40 }, viewport, 6), { x: 1544, y: 974, width: 52, height: 22 });

console.log("Watch face studio tour layout tests passed");
