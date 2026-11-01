/**
 * The watch's Toolbox (W332 3.2008.0). SYSTEM_SETTINGS_GET returns setting 0x1B as the
 * app's InteractivePb.MenuConfig: field 3 is a MenuItem with packed shown (1) and hidden (2)
 * app IDs. Setting 0x27 is the third-party feature switch, write-only: byte 0, bits 0–5 are
 * alipay, NetEase, Xiaoyuzhou, raster maps, pace strategy and ClimbPro. Each write makes the
 * firmware add or remove apps 0x11, 0x26 and 0x25 from the Toolbox to match their bits.
 */
export const SETTING_TOOLBOX = 0x1b;
export const SETTING_THIRD_PARTY = 0x27;
export const TOOLBOX_ALIPAY = 0x11, TOOLBOX_XIAOYUZHOU = 0x25, TOOLBOX_NETEASE = 0x26;

export interface ToolboxMenu { shown: number[]; hidden: number[] }
export type NeteaseToolboxState = "shown" | "hidden" | "missing";

const invalid = (): never => { throw new Error("The watch returned an invalid Toolbox list."); };

function varint(bytes: Buffer, offset: number): [number, number] {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (offset >= bytes.length) invalid();
    const byte = bytes[offset++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [value, offset];
  }
  return invalid();
}

function* fields(bytes: Buffer): Generator<[number, number, number | Buffer]> {
  for (let offset = 0; offset < bytes.length;) {
    const [key, next] = varint(bytes, offset);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) { const [value, end] = varint(bytes, next); offset = end; yield [field, wire, value]; }
    else if (wire === 2) {
      const [length, start] = varint(bytes, next);
      if (start + length > bytes.length) invalid();
      offset = start + length; yield [field, wire, bytes.subarray(start, offset)];
    } else invalid();
  }
}

/** Repeated uint32, packed or not. */
function ids(wire: number, value: number | Buffer, into: number[]): void {
  if (wire === 0) { into.push(value as number); return; }
  const packed = value as Buffer;
  for (let offset = 0; offset < packed.length;) { const [id, next] = varint(packed, offset); into.push(id); offset = next; }
}

export function decodeToolboxMenu(value: Buffer): ToolboxMenu {
  const menu: ToolboxMenu = { shown: [], hidden: [] };
  for (const [field, wire, item] of fields(value)) {
    if (field !== 3) continue;
    if (wire !== 2) invalid();
    for (const [entry, entryWire, id] of fields(item as Buffer)) {
      if (entry === 1) ids(entryWire, id, menu.shown);
      else if (entry === 2) ids(entryWire, id, menu.hidden);
    }
  }
  if (menu.shown.length + menu.hidden.length > 128) invalid();
  return menu;
}

export function neteaseToolboxState(menu: ToolboxMenu): NeteaseToolboxState {
  return menu.shown.includes(TOOLBOX_NETEASE) ? "shown" : menu.hidden.includes(TOOLBOX_NETEASE) ? "hidden" : "missing";
}

/**
 * The 0x27 byte that unlocks NetEase. The switch can't be read, but a locked app is never
 * in the Toolbox list, so Alipay and Xiaoyuzhou keep the state the list shows. Raster maps,
 * pace strategy and ClimbPro are left on: unlocking a feature is safer than removing one.
 */
export function neteaseThirdPartySwitch(menu: ToolboxMenu): number {
  const listed = (id: number) => menu.shown.includes(id) || menu.hidden.includes(id);
  return (listed(TOOLBOX_ALIPAY) ? 0x01 : 0) | 0x02 | (listed(TOOLBOX_XIAOYUZHOU) ? 0x04 : 0) | 0x38;
}
