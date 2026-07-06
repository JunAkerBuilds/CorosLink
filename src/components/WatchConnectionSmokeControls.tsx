import { useEffect, useState } from "react";
import type { WatchConnectionSmokeOptionId, WatchStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown, type SelectOption } from "./SelectDropdown";

const WATCH_SMOKE_OPTIONS: SelectOption<WatchConnectionSmokeOptionId>[] = [
  { value: "auto", label: "Auto (USB)" },
  { value: "none", label: "None" },
  { value: "pace-pro", label: "Pace Pro" },
  { value: "pace-4", label: "Pace 4" },
  { value: "pace-3", label: "Pace 3" },
  { value: "nomad", label: "Nomad" },
  { value: "vertix-2", label: "Vertix 2" },
  { value: "vertix-2s", label: "Vertix 2S" },
  { value: "unknown-pace", label: "Unknown Pace" },
  { value: "installer", label: "Installer volume" },
];

interface WatchConnectionSmokeControlsProps {
  api: CorosLinkApi | undefined;
  onWatchStatusChange: (status: WatchStatus) => void;
  onError: (message: string) => void;
}

export function WatchConnectionSmokeControls({
  api,
  onWatchStatusChange,
  onError,
}: WatchConnectionSmokeControlsProps) {
  const [value, setValue] = useState<WatchConnectionSmokeOptionId>("auto");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api || !import.meta.env.DEV) {
      return;
    }

    void api.getWatchConnectionSmokeOption().then(setValue);
  }, [api]);

  if (!import.meta.env.DEV) {
    return null;
  }

  async function handleChange(optionId: WatchConnectionSmokeOptionId) {
    if (!api || busy) {
      return;
    }

    setBusy(true);
    try {
      const status = await api.setWatchConnectionSmokeOption(optionId);
      setValue(optionId);
      onWatchStatusChange(status);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SelectDropdown
      className="app-select--pill app-select--watch-smoke"
      label="Watch connection fixture"
      value={value}
      options={WATCH_SMOKE_OPTIONS}
      disabled={!api || busy}
      onChange={(optionId) => void handleChange(optionId)}
    />
  );
}
