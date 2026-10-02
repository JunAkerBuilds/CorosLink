/** Pack grid presets and compact cards into the lowest available space. Fractional spans preserve compact widths. */
export function packDashboard(items: { span: number; height: number; startRow?: boolean; atBottom?: boolean }[], gap = 16) {
  let skyline = [{ start: 0, end: 12, bottom: 0 }];
  let rowTop = 0;
  const epsilon = 1e-7;
  const positions = items.map(({ span, height, startRow, atBottom }) => {
    // Only the explicit bottom drop clears every column. Row starts use the left column.
    if (atBottom) skyline = [{ start: 0, end: 12, bottom: Math.max(...skyline.map(segment => segment.bottom)) }];
    const width = Math.max(.01, Math.min(12, span));
    let column = 0;
    let top = Infinity;
    for (const { start } of skyline) {
      if (startRow && start > epsilon) continue;
      if (start + width > 12 + epsilon) continue;
      const candidate = Math.max(rowTop, ...skyline.filter(segment => segment.end > start + epsilon && segment.start < start + width - epsilon).map(segment => segment.bottom));
      if (candidate < top) { column = start; top = candidate; }
    }
    const end = Math.min(12, column + width);
    if (startRow || atBottom) rowTop = top;
    skyline = skyline.flatMap(segment => segment.end <= column + epsilon || segment.start >= end - epsilon ? [segment] : [
      ...(segment.start < column - epsilon ? [{ ...segment, end: column }] : []),
      ...(segment.end > end + epsilon ? [{ ...segment, start: end }] : [])
    ]);
    skyline.push({ start: column, end, bottom: top + height + gap });
    skyline.sort((a, b) => a.start - b.start);
    return { column, top };
  });
  return { positions, height: Math.max(0, ...skyline.map(segment => segment.bottom)) - (items.length ? gap : 0) };
}
