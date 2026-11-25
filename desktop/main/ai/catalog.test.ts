import { describe, expect, it } from "vitest";
import { defaultModel, localBase, provider, retiredGemini, writesText } from "./catalog";

describe("AI catalog", () => {
  it("keeps plain http to this computer and the local network", () => {
    expect(localBase("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(localBase("http://192.168.1.20:1234/v1")).toBe("http://192.168.1.20:1234/v1");
    expect(localBase("http://studio.local:8080/v1")).toBe("http://studio.local:8080/v1");
    expect(localBase("https://llm.example.com/v1")).toBe("https://llm.example.com/v1");
    expect(localBase("http://llm.example.com/v1")).toBeNull();
    expect(localBase("http://user:pw@localhost:1/v1")).toBeNull();
    expect(localBase("file:///etc/passwd")).toBeNull();
    expect(localBase(42)).toBeNull();
  });

  it("picks the phones' default model: preferred, then small, then first", () => {
    const openai = provider("openai")!;
    expect(defaultModel(openai, ["gpt-4o-mini", "gpt-5-mini", "gpt-6"])).toBe("gpt-5-mini");
    expect(defaultModel(openai, ["gpt-6", "gpt-6-mini"])).toBe("gpt-6-mini");
    expect(defaultModel(openai, ["gpt-6"])).toBe("gpt-6");
    expect(defaultModel(openai, [])).toBe("gpt-5-mini");
  });

  it("shows only models that write text, and no retired Gemini", () => {
    expect(["gpt-5-mini", "text-embedding-3-small", "gpt-4o-mini-tts", "whisper-1", "gpt-image-2"].filter(writesText)).toEqual(["gpt-5-mini"]);
    expect(["gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-3.8-flash"].filter((m) => !retiredGemini(m))).toEqual(["gemini-2.5-flash-lite", "gemini-3.8-flash"]);
  });
});
