// The main process's developer settings (devMode.ts), as the page reads and changes them.
export interface DeveloperState { devMode: boolean; sample: boolean; sampleItems: number | null }

export async function readDeveloper(): Promise<DeveloperState | null> {
  try {
    const answer = await fetch("/api/desktop/developer", { cache: "no-store" });
    return answer.ok ? ((await answer.json()) as DeveloperState) : null;
  } catch {
    return null;
  }
}

/** Changes a setting; the app then starts over on the store it now reads. */
export async function changeDeveloper(change: { devMode?: boolean; sample?: boolean; resetSample?: boolean }, then = "/developer"): Promise<void> {
  await fetch("/api/desktop/developer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
  window.location.assign(then);
}
