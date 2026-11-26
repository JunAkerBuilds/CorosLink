import { describe, expect, it } from "vitest";
import { computerFrom } from "./computer";

describe("what to call this computer", () => {
  it("names a Mac, a Windows PC, and anything else", () => {
    expect(computerFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 C-LINK/0.2.0 Electron/38.0.0")).toBe("Mac");
    expect(computerFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 C-LINK/0.2.0 Electron/38.0.0")).toBe("PC");
    expect(computerFrom("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 C-LINK/0.2.0 Electron/38.0.0")).toBe("computer");
    expect(computerFrom(undefined)).toBe("computer");
  });
});
