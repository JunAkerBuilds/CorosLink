import { useEffect, useState } from "react";

export const CARTO_SETTINGS_CHANGED = "coroslink:carto-settings-changed";

/** Keep credentials in memory only; the main process owns persistent storage. */
export function useCartoApiKey() {
  const [key, setKey] = useState("");
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const config = await window.corosLink?.getRouteBuilderConfig();
        if (active && current === request) setKey(config?.cartoApiKey ?? "");
      } catch { if (active && current === request) setKey(""); }
    };
    void refresh();
    window.addEventListener(CARTO_SETTINGS_CHANGED, refresh);
    return () => { active = false; window.removeEventListener(CARTO_SETTINGS_CHANGED, refresh); };
  }, []);
  return key;
}
