// One part of a live-data field (digits, icon, unit, states…) edited on its own, as CorosLink's NativeDataInspector
// does it: an official set or one image per picture, a picture's text, the part's box, alignment, font size and own
// font, and putting the part back. Pure functions over the field's style; each returns the patch to merge into it.
import type { CorosWatchfaceNativeAssetRole as Role, CorosWatchfaceNativeDataStyle as Style, CorosWatchfaceNativePart as Part, CorosWatchfaceNativePartStyle as PartStyle } from "../watchface/types";
import { nativePartForFontSize, nativeRoleIndices, withNativeFont } from "../watchface/engine/nativeDataParts";
import { NATIVE_DATA_BY_ID, nativeConfigPrefix } from "../watchface/watchfaceNativeCatalog";
import type { OfficialRequest } from "./studioOfficial";

/** A part's box, in master pixels before the layer's scale (CorosLink's 4–800). */
export const PART_BOX_MIN = 4;
export const PART_BOX_MAX = 800;
/** Longest side an imported picture keeps, as in CorosLink. */
export const PICTURE_SIDE_MAX = 1024;
export const PICTURE_TEXT_MAX = 32;

/** The template config key a part's official sets were bound to; none for parts the library doesn't tag. */
export function nativeOfficialConfigKey(id: string, role: Role): string | undefined {
  const field = NATIVE_DATA_BY_ID.get(id);
  if (!field) return undefined;
  if (role === "states") return field.stateKey;
  if (role === "digits") return `${nativeConfigPrefix(field)}_font`;
  if (role === "icon") return `${field.id}_icon`;
  if (role === "unit") return field.unitKey;
  return undefined;
}

/**
 * What the official browser opens on for a part: a whole set when the part has several pictures, one image
 * otherwise. Frame counts aren't fixed: official tables differ from the catalog (Sleep HRV ships 5) and fill in order.
 */
export function nativeOfficialRequest(id: string, style: Style, role: Role, partName: string): OfficialRequest {
  const set = nativeRoleIndices(id, style, role).length > 1;
  const label = NATIVE_DATA_BY_ID.get(id)?.label ?? id;
  const configKey = nativeOfficialConfigKey(id, role);
  return { mode: set ? "sprites" : "image", title: `Official ${partName.toLowerCase()} for ${label}`, ...(configKey ? { configKey } : {}) };
}

/** A picked official set as pictures by index: a whole set fills the part's pictures in order; an image fills `index`. */
export function officialPictures(indices: number[], frames: string[], index: number, frame = 0): Record<string, string> {
  if (indices.length > 1) return Object.fromEntries(indices.flatMap((state, position) => (frames[position] ? [[String(state), frames[position]!]] : [])));
  const picked = frames[frame] ?? frames[0];
  return picked ? { [String(index)]: picked } : {};
}

/** Puts pictures in place of the part's drawn ones; others keep theirs. */
export function withPictures(style: Style, role: Role, pictures: Record<string, string>): Pick<Style, "assets"> {
  return { assets: { ...style.assets, [role]: { ...style.assets?.[role], ...pictures } } };
}

/** Takes one picture's image away, so it's drawn from its text again. */
export function withoutPicture(style: Style, role: Role, index: number): Pick<Style, "assets"> {
  const pictures = { ...style.assets?.[role] };
  delete pictures[String(index)];
  const assets = { ...style.assets };
  if (Object.keys(pictures).length) assets[role] = pictures; else delete assets[role];
  return { assets: Object.keys(assets).length ? assets : undefined };
}

/** The text one drawn picture shows (up to 32 characters). */
export function withPictureText(style: Style, role: Role, index: number, text: string): Pick<Style, "assetTexts"> {
  return { assetTexts: { ...style.assetTexts, [role]: { ...style.assetTexts?.[role], [String(index)]: text.slice(0, PICTURE_TEXT_MAX) } } };
}

/** A part's own settings merged in. */
export function withPart(style: Style, part: Part, patch: PartStyle): Pick<Style, "parts"> {
  return { parts: { ...style.parts, [part]: { ...style.parts?.[part], ...patch } } };
}

export const clampBox = (v: number) => Math.round(Math.max(PART_BOX_MIN, Math.min(PART_BOX_MAX, v)));

/** Resizes the part's box so its text (or pictures) draw at `fontSize` master pixels. */
export function withPartFontSize(id: string, style: Style, part: Part, fontSize: number): Pick<Style, "parts"> {
  return withPart(style, part, nativePartForFontSize(id, style, part, fontSize));
}

/** Font settings a part can keep apart from the field's. */
const OWN_FONT_KEYS = ["fontFamily", "fontWeight", "fontStyle", "letterSpacing"] as const satisfies readonly (keyof PartStyle)[];

export function partHasOwnFont(style: Style, part: Part): boolean {
  return OWN_FONT_KEYS.some((key) => style.parts?.[part]?.[key] !== undefined);
}

/** The part's own font family; an empty one draws in the field's font (and brings back template glyph images). */
export function withPartFont(style: Style, part: Part, family: string): Pick<Style, "fontFamily" | "parts" | "assets" | "fontReplacedAssets"> {
  return withNativeFont(style, family, part);
}

/** Back to the field's font, weight, style and spacing. */
export function withoutPartFont(style: Style, part: Part): Pick<Style, "fontFamily" | "parts" | "assets" | "fontReplacedAssets"> {
  const reset = withNativeFont(style, "", part);
  const own = { ...reset.parts?.[part] };
  for (const key of OWN_FONT_KEYS) delete own[key];
  return { ...reset, parts: { ...reset.parts, [part]: own } };
}

/** Whether a part differs from its defaults: settings of its own, or images, texts or glyphs set aside for a font. */
export function partCustomized(style: Style, part: Part, role: Role | null): boolean {
  return Boolean(style.parts?.[part] && Object.keys(style.parts[part]!).length) ||
    (role ? [style.assets, style.assetTexts, style.fontReplacedAssets].some((sets) => Object.keys(sets?.[role] ?? {}).length > 0) : false);
}

/** Reset this part: its settings, images, texts and set-aside glyphs go; the rest of the field stays. */
export function withoutPartChanges(style: Style, part: Part, role: Role | null): Pick<Style, "parts" | "assets" | "assetTexts" | "fontReplacedAssets"> {
  const parts = { ...style.parts }, assets = { ...style.assets }, assetTexts = { ...style.assetTexts }, replaced = { ...style.fontReplacedAssets };
  delete parts[part];
  if (role) { delete assets[role]; delete assetTexts[role]; delete replaced[role]; }
  const orNone = <T extends object>(o: T) => (Object.keys(o).length ? o : undefined);
  return { parts: orNone(parts), assets: orNone(assets), assetTexts: orNone(assetTexts), fontReplacedAssets: orNone(replaced) };
}

/** The size a picture is kept at: its longest side at most 1024 px. */
export function pictureFit(width: number, height: number): { width: number; height: number } {
  const ratio = Math.min(1, PICTURE_SIDE_MAX / Math.max(1, width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
