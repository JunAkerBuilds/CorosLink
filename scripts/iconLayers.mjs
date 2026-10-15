// Splits the icon artwork into a static base and the sync arrows so the arrows
// can spin as their own <img>. The compositor rotates that cached texture for
// free; an animation inside a single SVG re-rasterizes every blur filter in the
// icon on every frame.

/** Returns [start, end) of the line-aligned <g id="..."> element, matching nested groups. */
function groupRange(svg, id) {
  const open = svg.indexOf(`<g id="${id}"`);
  if (open === -1) {
    throw new Error(`The SVG source has no <g id="${id}">.`);
  }
  const tags = /<(\/?)g\b[^>]*?(\/?)>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let match = tags.exec(svg); match; match = tags.exec(svg)) {
    if (match[1]) {
      depth -= 1;
    } else if (!match[2]) {
      depth += 1;
    }
    if (depth === 0) {
      const lineEnd = svg.indexOf("\n", match.index);
      return [svg.lastIndexOf("\n", open) + 1, lineEnd === -1 ? svg.length : lineEnd + 1];
    }
  }
  throw new Error(`<g id="${id}"> is not closed.`);
}

function cut(svg, [start, end]) {
  return svg.slice(0, start) + svg.slice(end);
}

/**
 * Sync arrows must be the last thing drawn (last child of #logo, itself last)
 * so stacking the sync layer over the base reproduces the icon exactly.
 */
export function splitSyncLayer(svg) {
  const [syncStart, syncEnd] = groupRange(svg, "sync-circle");
  const [, logoEnd] = groupRange(svg, "logo");
  if (svg.slice(syncEnd, logoEnd).trim() !== "</g>" || svg.slice(logoEnd).trim() !== "</svg>") {
    throw new Error('<g id="sync-circle"> must be the last element drawn.');
  }
  const base = cut(svg, [syncStart, syncEnd]);
  // Keep #logo itself: the arrows inherit its stroke-linejoin/linecap.
  const logoOpen = svg.indexOf('<g id="logo"');
  const logoBody = svg.indexOf("\n", logoOpen) + 1;
  const sync = cut(cut(svg, [logoBody, syncStart]), groupRange(svg, "background"));
  return { base, sync };
}
