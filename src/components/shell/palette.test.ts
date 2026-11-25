import { describe, expect, it } from "vitest";
import { paletteGrid, paletteMove } from "./paletteLayout";

const G = (group: number, ...labels: string[]) => labels.map((label) => ({ href: `/${label}`, label, group }));
// The sidebar's pages and groups.
const NAV = [...G(0, "Dashboard", "Calendar", "Library", "Activities"), ...G(1, "Health", "Fuel", "Body", "Sports", "Strength"), ...G(2, "Coach", "Community"), ...G(3, "Watch")];

const EXTRA = [{ href: "/a", label: "A" }, { href: "/b", label: "B" }, { href: "/c", label: "C" }];

describe("palette grid", () => {
  const grid = paletteGrid(NAV, EXTRA);
  const at = (label: string) => grid.findIndex((e) => e.label === label);

  it("lays pages two to a row, each sidebar group on a new row, chips last", () => {
    expect(grid.slice(0, 4).map((e) => [e.row, e.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
    // Health starts its group on a new row; Strength, the group's fifth, sits alone.
    expect(grid[at("Health")]).toMatchObject({ row: 2, col: 0 });
    expect(grid[at("Strength")]).toMatchObject({ row: 4, col: 0 });
    expect(grid[at("Coach")]).toMatchObject({ row: 5, col: 0 });
    expect(grid[at("Watch")]).toMatchObject({ row: 6, col: 0 });
    expect(grid.slice(-3).map((e) => [e.row, e.col])).toEqual([[7, 0], [7, 1], [7, 2]]);
  });

  it("moves along rows and to the closest item above or below", () => {
    expect(paletteMove(grid, at("Calendar"), "ArrowDown")).toBe(at("Activities"));
    expect(paletteMove(grid, at("Strength"), "ArrowUp")).toBe(at("Body"));
    expect(paletteMove(grid, at("Community"), "ArrowDown")).toBe(at("Watch"));
    expect(paletteMove(grid, at("Dashboard"), "ArrowUp")).toBe(at("Dashboard"));
    expect(paletteMove(grid, at("Dashboard"), "ArrowLeft")).toBe(at("Dashboard"));
    expect(paletteMove(grid, at("Dashboard"), "ArrowRight")).toBe(at("Calendar"));
    expect(paletteMove(grid, at("Watch"), "ArrowDown")).toBe(at("A"));
    expect(paletteMove(grid, at("C"), "ArrowDown")).toBe(at("C"));
  });
});
