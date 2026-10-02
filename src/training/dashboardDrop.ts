export interface DashboardDropTarget { index: number; startRow: boolean; atBottom?: boolean; anchor?: string }
export interface DashboardDragCard { id: string; left: number; top: number; right: number; bottom: number }

/** Resolve insertion from card edges, rather than always swapping with a card's array index. */
export function dashboardDropTarget(cards: DashboardDragCard[], dragged: string, x: number, y: number): DashboardDropTarget | null {
  const from = cards.findIndex(card => card.id === dragged);
  if (from < 0) return null;
  if (y >= Math.max(...cards.map(card => card.bottom))) return { index: cards.length - 1, startRow: true, atBottom: true };
  const contains = (card: DashboardDragCard) => x >= card.left && x <= card.right && y >= card.top && y <= card.bottom;
  if (contains(cards[from])) return null;
  const others = cards.filter(card => card.id !== dragged);
  if (!others.length) return null;
  const distance = (card: DashboardDragCard) => Math.hypot(Math.max(card.left - x, 0, x - card.right), Math.max(card.top - y, 0, y - card.bottom));
  const nearest = others.reduce((best, card) => distance(card) < distance(best) ? card : best);
  const dx = (x - (nearest.left + nearest.right) / 2) / Math.max(1, nearest.right - nearest.left);
  const dy = (y - (nearest.top + nearest.bottom) / 2) / Math.max(1, nearest.bottom - nearest.top);
  const vertical = Math.abs(dy) >= Math.abs(dx);
  const after = vertical ? dy >= 0 : dx >= 0;
  const insertion = cards.indexOf(nearest) + (after ? 1 : 0);
  return { index: insertion - (from < insertion ? 1 : 0), startRow: vertical && after, anchor: nearest.id };
}
