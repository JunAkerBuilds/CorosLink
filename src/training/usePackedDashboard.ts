import { useLayoutEffect, useRef } from 'react';
import { packDashboard } from './dashboardPacking';
import { widgetPresets, type WidgetId } from './dashboardLayout';
import { sizePresetHeight, sizePresetWidth } from './widgetSizing';

/** Observe intrinsic card heights so settings, async data and window resizing repack the layout. */
export function usePackedDashboard() {
  const gridRef = useRef<HTMLDivElement>(null);
  const packRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;
    const cards = () => Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-widget]'));
    const pack = () => {
      const width = grid.clientWidth;
      if (!width) return;
      const gap = 16;
      const unit = (width + gap) / 12;
      const children = cards();
      const spans = children.map(card => {
        const preset = widgetPresets(card.dataset.widget as WidgetId).find(choice => choice.id === card.dataset.preset)!;
        const style = getComputedStyle(card);
        const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        return (sizePresetWidth(preset, width, chrome) + gap) / unit;
      });
      grid.dataset.packed = 'true';
      children.forEach((card, index) => {
        const cardWidth = spans[index] * unit - gap;
        card.style.width = `${cardWidth}px`;
        const preset = widgetPresets(card.dataset.widget as WidgetId).find(choice => choice.id === card.dataset.preset)!;
        card.style.setProperty('--widget-min-height', `${preset.matchCompactHeight ? sizePresetHeight(preset, cardWidth, width) : preset.minHeight}px`);
      });
      // Keep the main panels consistent, with separate baselines for standard and tall presets.
      const overview = children.filter(card => ['recovery', 'fitness', 'sleep', 'vo2'].includes(card.dataset.widget!));
      overview.forEach(card => card.style.removeProperty('--widget-aligned-height'));
      if (width > 850) {
        for (const expanded of ['false', 'true']) {
          const group = overview.filter(card => card.dataset.expanded === expanded);
          if (group.length < 2) continue;
          const height = Math.max(...group.map(card => card.querySelector('.hub-widget-content > .panel')!.getBoundingClientRect().height));
          group.forEach(card => card.style.setProperty('--widget-aligned-height', `${height}px`));
        }
      }
      const healthCheck = children.find(card => card.dataset.widget === 'healthCheck' && card.dataset.preset?.endsWith('-mini'));
      healthCheck?.style.removeProperty('--widget-aligned-height');
      const upcoming = children.find(card => card.dataset.widget === 'upcoming');
      upcoming?.style.removeProperty('--widget-aligned-height');
      const measure = () => packDashboard(children.map((card, index) => ({ span: spans[index], height: card.getBoundingClientRect().height, startRow: card.dataset.startRow === 'true', atBottom: card.dataset.atBottom === 'true' })), gap);
      let result = measure();
      const sleep = children.find(card => card.dataset.widget === 'sleep');
      if (width > 850 && sleep && healthCheck) {
        const sleepPosition = result.positions[children.indexOf(sleep)];
        const healthPosition = result.positions[children.indexOf(healthCheck)];
        if (Math.abs(sleepPosition.top - healthPosition.top) < 1) {
          const height = Math.max(
            sleep.querySelector('.sleep-panel')!.getBoundingClientRect().height,
            healthCheck.querySelector('.health-insight-card')!.getBoundingClientRect().height
          );
          sleep.style.setProperty('--widget-aligned-height', `${height}px`);
          healthCheck.style.setProperty('--widget-aligned-height', `${height}px`);
          result = measure();
        }
      }
      // Match the profile row without changing the saved compact preview or stretching mobile cards.
      if (width > 850 && upcoming?.dataset.preset?.endsWith('-short')) {
        const top = result.positions[children.indexOf(upcoming)].top;
        const peers = children.filter(card => ['scores', 'race', 'effort'].includes(card.dataset.widget!)
          && Math.abs(result.positions[children.indexOf(card)].top - top) < 1);
        if (peers.length) {
          const height = Math.max(...peers.map(card => card.querySelector('.hub-widget-content > .panel')!.getBoundingClientRect().height));
          upcoming.style.setProperty('--widget-aligned-height', `${height}px`);
          result = measure();
        }
      }
      children.forEach((card, index) => {
        card.style.left = `${result.positions[index].column * unit}px`;
        card.style.top = `${result.positions[index].top}px`;
      });
      grid.style.height = `${result.height}px`;
    };
    packRef.current = pack;
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(pack); };
    const observer = new ResizeObserver(schedule);
    const observeCards = () => {
      observer.disconnect();
      observer.observe(grid);
      cards().forEach(card => observer.observe(card));
      pack();
    };
    const mutations = new MutationObserver(observeCards);
    mutations.observe(grid, { childList: true });
    observeCards();
    return () => { packRef.current = null; observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  // Repack changed widths and edit controls after React commits, before paint.
  useLayoutEffect(() => { packRef.current?.(); });
  return gridRef;
}
