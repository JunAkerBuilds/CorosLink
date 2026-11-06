import { useEffect, useState } from "react";

/**
 * Lets the app shell know a Watch Face Studio editor is on screen, so it can
 * fold the main sidebar to icons and give the face the room.
 */
const EVENT = "coroslink:studio-editor-presence";
let openEditors = 0;

export function announceStudioEditor(): () => void {
  openEditors += 1;
  window.dispatchEvent(new Event(EVENT));
  return () => {
    openEditors = Math.max(0, openEditors - 1);
    window.dispatchEvent(new Event(EVENT));
  };
}

export function useStudioEditorOpen(): boolean {
  const [open, setOpen] = useState(openEditors > 0);
  useEffect(() => {
    const sync = () => setOpen(openEditors > 0);
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return open;
}
