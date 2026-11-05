/**
 * Bluetooth and Do Not Disturb are one indicator each on the watch: several
 * images at one position key, and the firmware picks one by the current state.
 * PACE Pro 3.2008.0 (0x4cb4c4) draws the airplane image at the Bluetooth
 * position while airplane mode is on, and the sleep image at the Do Not Disturb
 * position while sleep mode is on, in place of the on/off image; without that
 * image it falls back to on/off. Studio lists each group as one component and
 * edits its states in the panel.
 */
export interface WatchfaceStatusState {
  key: string;
  label: string;
  hint: string;
}
export interface WatchfaceStatusGroup {
  id: string;
  label: string;
  states: readonly WatchfaceStatusState[];
  /** The state a new indicator starts with, and the preview's default. */
  primary: string;
}

export const WATCHFACE_STATUS_GROUPS: readonly WatchfaceStatusGroup[] = [
  {
    id: "bluetooth", label: "Bluetooth", primary: "bluetooth_off_icon",
    states: [
      { key: "bluetooth_on_icon", label: "On", hint: "Shows while Bluetooth is on." },
      { key: "bluetooth_off_icon", label: "Off", hint: "Shows while Bluetooth is off." },
      { key: "airplane_icon", label: "Airplane mode", hint: "Replaces the on and off icons while airplane mode is on." }
    ]
  },
  {
    id: "doNotDisturb", label: "Do Not Disturb", primary: "no_disturb_on_icon",
    states: [
      { key: "no_disturb_on_icon", label: "On", hint: "Shows while Do Not Disturb is on." },
      { key: "no_disturb_off_icon", label: "Off", hint: "Shows while Do Not Disturb is off." },
      { key: "sleep_mode_icon", label: "Sleep mode", hint: "Replaces the on and off icons while sleep mode is on." }
    ]
  }
];

export function watchfaceStatusGroupOf(configKey: string | undefined): WatchfaceStatusGroup | null {
  return WATCHFACE_STATUS_GROUPS.find(group => group.states.some(state => state.key === configKey)) ?? null;
}

/**
 * The state a group lists and previews: the chosen one if the face has it,
 * else the primary one if the face has that, else the first it has.
 */
export function watchfaceStatusActiveKey(group: WatchfaceStatusGroup, has: (configKey: string) => boolean, chosen?: string): string {
  if (chosen && group.states.some(state => state.key === chosen) && has(chosen)) return chosen;
  if (has(group.primary)) return group.primary;
  return group.states.find(state => has(state.key))?.key ?? group.primary;
}

/** Images the preview leaves out, so each group shows one state at a time. */
export function watchfaceHiddenStatusKeys(has: (configKey: string) => boolean, chosen: Readonly<Record<string, string>> = {}): string[] {
  return WATCHFACE_STATUS_GROUPS.flatMap(group => {
    const active = watchfaceStatusActiveKey(group, has, chosen[group.id]);
    return group.states.map(state => state.key).filter(key => key !== active);
  });
}
