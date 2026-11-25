// The "From library" list on Add to calendar: signed in to the store on this computer never shows the sample athlete's.
import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = vi.hoisted(() => ({ clink: false }));
vi.mock("@/data/sync", () => ({ syncView: async () => (signedIn.clink ? {} : null) }));
vi.mock("@/data/hub", async (original) => ({ ...(await original<typeof import("@/data/hub")>()), hubSession: async () => ({ state: "signedOut" }) }));

import { loadAddToCalendar } from "./workouts";

describe("the library with COROS not connected", () => {
  beforeEach(() => { signedIn.clink = false; });

  it("is the sample athlete's only when nobody is signed in", async () => {
    const loaded = await loadAddToCalendar();
    expect(loaded.origin).toBe("sample");
    expect(loaded.data.library.length).toBeGreaterThan(0);
  });

  it("is empty, and not marked as sample data, for someone signed in to C-LINK with nothing saved here", async () => {
    signedIn.clink = true;
    const loaded = await loadAddToCalendar();
    expect(loaded.origin).toBe("browser");
    expect(loaded.data).toMatchObject({ toCoros: false, library: [], pacing: null });
  });
});
