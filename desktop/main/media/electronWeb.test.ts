import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: { fromPartition: () => ({}) } }));
const { agentFor, asFirefox, isGoogleSignIn } = await import("./electronWeb");

describe("Google sign-in", () => {
  it("is only accounts.google.com", () => {
    expect(isGoogleSignIn("https://accounts.google.com/ServiceLogin?service=youtube")).toBe(true);
    expect(isGoogleSignIn("https://music.youtube.com/library")).toBe(false);
    expect(isGoogleSignIn("not a url")).toBe(false);
  });

  it("is shown Firefox; everything else Chrome", () => {
    expect(agentFor("https://accounts.google.com/v3/signin")).toMatch(/Firefox\/\d+/);
    expect(agentFor("https://accounts.google.com/v3/signin")).not.toMatch(/Chrome|Electron/);
    expect(agentFor("https://www.youtube.com/")).toMatch(/AppleWebKit.*Chrome\//);
    expect(agentFor("https://www.youtube.com/")).not.toMatch(/Electron/);
  });

  it("gets no Chromium client hints and one Firefox user agent", () => {
    const out = asFirefox({ "user-agent": "Electron", "sec-ch-ua": "\"Chromium\";v=\"140\"", "Sec-CH-UA-Platform": "\"macOS\"", Accept: "*/*" });
    expect(Object.keys(out).sort()).toEqual(["Accept", "User-Agent"]);
    expect(out["User-Agent"]).toMatch(/Firefox/);
  });
});
