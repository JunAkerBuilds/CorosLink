/** The Go to palette's layout and arrow-key moves, kept apart from the shell so they test without a page. */

export type PaletteEntry = { href: string; label: string; icon?: string; where?: string; ask?: boolean; row: number; col: number };

/** The palette's items laid out: the pages two to a row with each sidebar group starting a new row, then the chips. */
export function paletteGrid(pages: readonly { href: string; label: string; group: number; icon?: string }[], extra: readonly { href: string; label: string; where?: string }[]): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  let row = -1, col = 2, group: number | null = null;
  for (const p of pages) {
    if (p.group !== group || col === 2) { row += 1; col = 0; group = p.group; }
    out.push({ href: p.href, label: p.label, icon: p.icon, row, col });
    col += 1;
  }
  row += 1;
  extra.forEach((e, i) => out.push({ ...e, row, col: i }));
  return out;
}

/** Where an arrow key goes from `at`: along the row, or to the closest item in the row above or below. */
export function paletteMove(items: readonly PaletteEntry[], at: number, key: string): number {
  const cur = items[at];
  if (!cur) return 0;
  if (key === "ArrowLeft") return Math.max(0, at - 1);
  if (key === "ArrowRight") return Math.min(items.length - 1, at + 1);
  const row = cur.row + (key === "ArrowDown" ? 1 : -1);
  const inRow = items.map((e, i) => ({ e, i })).filter(({ e }) => e.row === row);
  if (!inRow.length) return at;
  // The chips row is wider than the grid: keep the column in proportion to each row's width.
  const width = (r: number) => items.filter((e) => e.row === r).length;
  const want = (cur.col / Math.max(1, width(cur.row) - 1)) * (inRow.length - 1);
  return inRow.reduce((best, x) => (Math.abs(x.e.col - want) < Math.abs(best.e.col - want) ? x : best)).i;
}
