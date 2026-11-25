import { describe, expect, it, vi } from "vitest";

// safeStorage that only opens what it sealed itself ("own:" + text), like a keychain under one name.
vi.mock("electron", () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (text: string) => Buffer.from(`own:${text}`),
    decryptStringAsync: async (data: Buffer) => {
      const text = data.toString("utf8");
      if (!text.startsWith("own:")) throw new Error("Error while decrypting the ciphertext provided to safeStorage.decryptString.");
      return { result: text.slice(4), shouldReEncrypt: false };
    },
  },
}));

const { keychain, keychainName, setKeychainFallback } = await import("./secrets");

describe("C-LINK's keychain", () => {
  it("seals with CorosLink's item only in a shipped Mac build", () => {
    expect(keychainName(true, "darwin")).toBe("CorosLink");
    expect(keychainName(false, "darwin")).toBeNull();
    expect(keychainName(true, "win32")).toBeNull();
    expect(keychainName(true, "linux")).toBeNull();
  });

  it("opens a value sealed under the other name once, asking it to be sealed again", async () => {
    expect(await keychain.decrypt(Buffer.from("own:mine"))).toEqual({ text: "mine", stale: false });
    setKeychainFallback({ open: async (b64) => (Buffer.from(b64, "base64").toString() === "old:theirs" ? "theirs" : null) });
    expect(await keychain.decrypt(Buffer.from("old:theirs"))).toEqual({ text: "theirs", stale: true });
    await expect(keychain.decrypt(Buffer.from("garbage"))).rejects.toThrow(/decrypting/);
    setKeychainFallback(null);
    await expect(keychain.decrypt(Buffer.from("old:theirs"))).rejects.toThrow(/decrypting/);
  });
});
