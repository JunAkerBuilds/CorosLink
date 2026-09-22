import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, RotateCcw, Settings2, Undo2, X } from 'lucide-react';
import { dashboardStorageKey, defaultLayout, defaultWidget, moveWidget, parseLayout, widgetCatalog, widgetPreset, widgetPresets, type DashboardWidget, type WidgetId } from '../dashboardLayout';
import '../dashboardLayout.css';
import { usePackedDashboard } from '../usePackedDashboard';
import { WidgetResizeHandle } from './WidgetResizeHandle';
import { WidgetDropPreview } from './WidgetDropPreview';
import type { WidgetSizePreset } from '../widgetSizing';
import { useDashboardDrag } from '../useDashboardDrag';

export function CustomizableDashboard({ renderWidget, sampleMode = false, toolbarTarget }: {
  renderWidget: (widget: DashboardWidget) => ReactNode; sampleMode?: boolean; toolbarTarget?: HTMLDivElement | null;
}) {
  const gridRef = usePackedDashboard();
  const storageKey = dashboardStorageKey + (sampleMode ? '.sample' : '');
  const [layout, setLayout] = useState(() => { try { return parseLayout(localStorage.getItem(storageKey)); } catch { return defaultLayout(); } });
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(false);
  const [query, setQuery] = useState('');
  const [resizing, setResizing] = useState<{ id: WidgetId; preset: WidgetSizePreset } | null>(null);
  const [history, setHistory] = useState<DashboardWidget[][]>([]);
  const [saveError, setSaveError] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const libraryTitle = useId();
  const drag = useDashboardDrag(gridRef, (id, destination) => {
    const next = moveWidget(layout, id, destination.index, destination.startRow, destination.atBottom);
    if (next !== layout) update(next, 'Widget moved');
  });
  const { dragged, target } = drag;
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 3, widgets: layout })); setSaveError(false); }
    catch { setSaveError(true); }
  }, [layout, storageKey]);
  useEffect(() => { if (library) dialog.current?.showModal(); else dialog.current?.close(); }, [library]);
  function update(next: DashboardWidget[], message: string) {
    setHistory(previous => [...previous.slice(-29), layout]); setLayout(next); setAnnouncement(message);
  }
  function resize(id: WidgetId, preset: WidgetSizePreset) {
    const current = layout.find(widget => widget.id === id);
    if (!current || current.preset === preset.id) return;
    configure(id, { preset: preset.id, size: preset.columns });
    setAnnouncement(`${current.title || widgetCatalog.find(widget => widget.id === id)!.title} resized to ${preset.label}`);
  }
  const visibleLayout = layout.map(widget => resizing?.id === widget.id ? { ...widget, size: resizing.preset.columns, preset: resizing.preset.id } : widget);
  function configure(id: WidgetId, patch: Partial<DashboardWidget>) {
    update(layout.map(widget => widget.id === id ? { ...widget, ...patch } : widget), 'Widget updated');
  }
  const controls = (
      <div className="hub-dashboard-buttons" inert={Boolean(resizing)}>
        {editing && <><button type="button" disabled={!history.length} onClick={() => { setLayout(history[history.length - 1]); setHistory(history.slice(0, -1)); setAnnouncement('Change undone'); }}><Undo2 size={15} />Undo</button>
          <button type="button" onClick={() => update(defaultLayout(), 'Default dashboard restored. Use Undo to recover your layout.')}><RotateCcw size={15} />Reset layout</button>
          <button type="button" onClick={() => setLibrary(true)}><Plus size={15} />Add widget</button></>}
        <button type="button" className="hub-dashboard-edit" aria-pressed={editing} onClick={() => { setEditing(!editing); drag.cancel(); }}>{editing ? <Check size={15} /> : <Settings2 size={15} />}{editing ? 'Done' : 'Edit dashboard'}</button>
      </div>
  );
  return <section className={`hub-dashboard ${editing ? 'is-editing' : ''} ${resizing ? 'is-resizing' : ''}`} aria-label="Customizable training dashboard">
    {toolbarTarget ? createPortal(controls, toolbarTarget) : <div className="hub-dashboard-toolbar">{controls}</div>}
    {(saveError || editing) && <p className="hub-dashboard-hint">{saveError ? 'Changes could not be saved on this device. Keep this view open to retain them.' : 'Drag to arrange. Drag a corner to resize. Changes save automatically.'}</p>}
    <span className="hub-dashboard-sr" role="status">{announcement}</span>
    {!layout.length && <div className="panel hub-dashboard-empty"><h2>Make room for what matters</h2><p>Add widgets to build your training dashboard.</p><button type="button" onClick={() => { setEditing(true); setLibrary(true); }}><Plus size={16} />Add widget</button></div>}
    <div className="hub-dashboard-grid" ref={gridRef}>

      {visibleLayout.map((widget, index) => {
        const definition = widgetCatalog.find(item => item.id === widget.id)!;
        const title = widget.title || definition.title;
        const preset = widgetPreset(widget);
        return <div key={widget.id} tabIndex={editing ? 0 : undefined} aria-label={editing ? `${title}. Drag to move, or use Alt and arrow keys.` : undefined}
          onPointerDown={editing && !resizing ? event => drag.pointerStart(event, widget.id) : undefined}
          onKeyDown={event => {
            if (!editing || resizing || event.target !== event.currentTarget || !event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            const next = moveWidget(layout, widget.id, index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1));
            if (next !== layout) update(next, `${title} moved`);
          }} data-widget={widget.id} data-start-row={widget.startRow || undefined} data-at-bottom={widget.atBottom || undefined} data-preset={preset.id} data-shape={preset.aspectRatio === 1 ? "square" : undefined} data-compact={Boolean(preset.contentWidth) || undefined} data-expanded={preset.expanded} className={`hub-dashboard-widget ${target?.anchor === widget.id ? 'is-drop-target' : ''} ${resizing?.id === widget.id ? 'is-resizing' : ''} ${dragged === widget.id ? 'is-dragging' : ''}`} style={{ '--widget-span': widget.size, '--widget-proportional-height': preset.aspectRatio ? `${100 / preset.aspectRatio}cqw` : '0px', '--widget-min-height': `${preset.minHeight}px`, '--widget-chart-height': preset.expanded ? '300px' : '180px' } as CSSProperties}>
          {editing && <button type="button" className="hub-widget-remove" disabled={Boolean(resizing)} aria-label={`Remove ${title}`} title={`Remove ${title}`} onPointerDown={event => event.stopPropagation()} onClick={() => update(layout.filter(item => item.id !== widget.id), `${title} removed. Use Undo to restore it.`)}><X size={14} aria-hidden="true" /></button>}
          {!editing && widget.title && <h2 className="hub-widget-label">{widget.title}</h2>}
          <div className="hub-widget-content" inert={editing}>{renderWidget(widget)}</div>
          {resizing?.id === widget.id && <span className="hub-resize-preview" role="status">{preset.label} · Release to apply</span>}
          {editing && <WidgetResizeHandle title={title} preset={preset} presets={widgetPresets(widget.id)}
            onPreview={choice => setResizing(choice ? { id: widget.id, preset: choice } : null)}
            onCommit={choice => resize(widget.id, choice)} />}

        </div>;
      })}
      {dragged && target && <WidgetDropPreview gridRef={gridRef} layout={layout} dragged={dragged} target={target} />}
    </div>
    {editing && <div className={`hub-widget-drop-end ${dragged ? 'is-dragging' : ''}`} style={dragged ? { minHeight: drag.height + 32 } : undefined}>
      <span>Drag a widget here to move it to the bottom</span>
    </div>}
    <dialog ref={dialog} className="hub-widget-library" aria-labelledby={libraryTitle} onCancel={() => setLibrary(false)} onClose={() => setLibrary(false)} onClick={event => { if (event.target === event.currentTarget) setLibrary(false); }}>
      <div className="hub-library-inner"><div className="hub-dashboard-toolbar"><div><p className="eyebrow">Make it yours</p><h2 id={libraryTitle}>Widget library</h2></div><button type="button" aria-label="Close widget library" onClick={() => setLibrary(false)}><X size={18} /></button></div>
        <input autoFocus type="search" aria-label="Search widgets" placeholder="Search widgets…" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="hub-library-list">{widgetCatalog.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map(item => {
          const added = layout.some(widget => widget.id === item.id);
          return <div key={item.id}><div><strong>{item.title}</strong><p>{item.description}</p></div><button type="button" disabled={added} aria-label={`${added ? 'Added' : 'Add'} ${item.title}`} onClick={() => update([...layout, defaultWidget(item.id)], `${item.title} added`)}>{added ? <Check size={16} /> : <Plus size={16} />}{added ? 'Added' : 'Add'}</button></div>;
        })}</div>
        {!widgetCatalog.some(item => `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase())) && <p>No widgets match your search.</p>}
      </div>
    </dialog>
  </section>;
}
