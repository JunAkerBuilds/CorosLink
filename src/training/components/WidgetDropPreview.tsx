import { useLayoutEffect, useState, type RefObject } from 'react';
import { moveWidget, widgetCatalog, widgetPreset, type DashboardWidget, type WidgetId } from '../dashboardLayout';
import { packDashboard } from '../dashboardPacking';
import { sizePresetWidth } from '../widgetSizing';
import type { DashboardDropTarget } from '../dashboardDrop';

export function WidgetDropPreview({ gridRef, layout, dragged, target }: {
  gridRef: RefObject<HTMLDivElement | null>; layout: DashboardWidget[]; dragged: WidgetId; target: DashboardDropTarget;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const width = grid.clientWidth;
    const unit = (width + 16) / 12;
    const elements = new Map(Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-widget]')).map(card => [card.dataset.widget!, card]));
    const ordered = moveWidget(layout, dragged, target.index, target.startRow, target.atBottom);
    const items = ordered.map(widget => {
      const card = elements.get(widget.id);
      const rect = card?.getBoundingClientRect();
      const content = card?.querySelector('.hub-widget-content')?.getBoundingClientRect();
      return { span: (sizePresetWidth(widgetPreset(widget), width, rect && content ? rect.width - content.width : 0) + 16) / unit, height: rect?.height ?? 0, startRow: widget.startRow, atBottom: widget.atBottom };
    });
    const packed = packDashboard(items);
    const index = ordered.findIndex(widget => widget.id === dragged);
    setRect({ left: packed.positions[index].column * unit, top: packed.positions[index].top, width: items[index].span * unit - 16, height: items[index].height });
  }, [gridRef, layout, dragged, target]);
  const title = layout.find(widget => widget.id === dragged)?.title || widgetCatalog.find(widget => widget.id === dragged)!.title;
  return rect && <div className="hub-drop-preview" style={rect} aria-hidden="true"><span>Place {title} here</span></div>;
}
