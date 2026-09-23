const obj = (value: any): any => value && typeof value === "object" ? value : {};
export const atPath = (value: any, path: string): any => path.split("/").slice(1).reduce((node, key) => obj(node)[key.replace(/~1/g, "/").replace(/~0/g, "~")], value);
export function typographyContract(contract: any): boolean {
  return Boolean(contract.rasterFontPath || contract.typography === true ||
    ["paired-labels", "drawn-separator"].includes(contract.kind) ||
    contract.elementKind === "text" ||
    ["digits", "symbols", "unit", "units", "decimal", "label"].includes(contract.assetRole) ||
    contract.kind === "weather-assets" && ["digits", "symbols", "units"].includes(contract.id?.split(":")[1]));
}
export function fontHasGeneratedText(font: any, text: string, generated: (value: any) => boolean): boolean {
  const label = font?.sprites?.[text] ?? font?.labels?.[text];
  if (label) return generated(label);
  return [...text].every(character => font?.sprites?.[character]
    ? generated(font.sprites[character])
    : String(font?.glyphs ?? "").includes(character) && Number.isInteger(font?.columns) && font.columns > 0 && generated(font?.dataUrl));
}

export function visibleTypography(doc: any): any[] {
  const layers = doc?.capabilities?.layers;
  return (doc?.capabilities?.assetContracts ?? []).filter((contract: any) => typographyContract(contract) && contract.enabled !== false &&
    (!contract.layerId || !layers || layers.some((layer: any) => layer.id === contract.layerId && layer.visible !== false)));
}

/** Check each live text role independently; a clock atlas cannot cover metric,
 * calendar, native, punctuation or static text merely by containing 0–9. */
export function verifyTypographyCoverage(doc: any, scope: "all" | string[], bindings: any[], generated: (value: any) => boolean, targets: any[] = []): void {
  const contracts: any[] = doc.capabilities?.assetContracts ?? [];
  const layers: any[] | undefined = doc.capabilities?.layers;
  const eligible = [...new Map([...targets, ...contracts.filter(typographyContract)].map(contract => [contract.id, contract])).values()];
  const requested = scope === "all" ? eligible.filter(contract => targets.some(target => target.id === contract.id) || visibleTypography(doc).some(active => active.id === contract.id))
    : scope.map(id => {
      const found = eligible.find(contract => contract.id === id);
      if (!found) throw new Error(`Unknown typography component ${id}. Inspect assetContracts.`);
      return found;
    });
  if (!requested.length) throw new Error("No visible typography contracts found for this scope. Inspect the current mode and requested components.");
  for (const contract of requested) {
    const fail = (why: string): never => { throw new Error(`${contract.id}: ${why}`); };
    if (contract.kind === "drawn-separator" || contract.elementKind === "text") {
      const originalActive = visibleTypography(doc).some(active => active.id === contract.id);
      if (originalActive) fail("editor-drawn text/punctuation is still present. Disable it after installing its generated replacement.");
      const replacement = bindings.find(binding => binding.componentId === contract.id && /\/designSprites\/\d+\/dataUrl$/.test(binding.designPath));
      if (!replacement || !generated(atPath(doc, replacement.designPath))) fail("requested static label/punctuation still needs an explicitly bound generated sprite; deleting or hiding text does not fulfill it.");
      const sprite = atPath(doc, replacement.designPath.replace(/\/dataUrl$/, ""));
      if (layers && !layers.some(layer => layer.id === `sprite:${sprite?.id}` && layer.visible !== false)) fail("replacement static text is hidden.");
      continue;
    }
    if (contract.enabled === false || contract.layerId && layers && !layers.some(layer => layer.id === contract.layerId && layer.visible !== false)) fail("requested typography is hidden or disabled.");
    const bound = (path: string) => bindings.some(binding => binding.designPath === path);
    if (contract.rasterFontPath) {
      const parentPath = contract.rasterFontPath.slice(0, -"/rasterFont".length);
      const style = obj(atPath(doc, parentPath));
      const root = contract.mode === "aod" ? "/design/modeDesigns/aod" : "/design";
      const design = obj(atPath(doc, root));
      if (style.fontFamily || contract.kind !== "paired-labels" && design.fontFamily) fail("fontFamily overrides the generated glyphs.");
      const path = style.rasterFont || contract.kind === "paired-labels" ? contract.rasterFontPath : `${root}/rasterFont`;
      const font = atPath(doc, path);
      if (!bound(path)) fail("missing installed font binding for this component.");
      if (!contract.orderedValues?.length || !contract.orderedValues.every((label: string) => fontHasGeneratedText(font, label, generated))) fail("every digit or ordered weekday/month label needs generated artwork; default text fallback is incomplete.");
    } else if (contract.assetsPath) {
      if (!bound(contract.assetsPath)) fail("missing native digit/label/symbol binding.");
      const installed = obj(atPath(doc, contract.assetsPath));
      if (!contract.stateIndices?.length || !contract.stateIndices.every((index: string) => generated(installed[index]))) fail("install generated artwork for every exact index, including sparse punctuation and units.");
    } else if (contract.replacementPath) {
      if (!bound(contract.replacementPath) || !generated(atPath(doc, contract.replacementPath)?.dataUrl)) fail("missing generated label or punctuation replacement.");
    } else {
      fail("editor-drawn text/punctuation is still present. Replace it with reviewed generated artwork, disable the drawn original, and verify the replacement binding.");
    }
  }
}
