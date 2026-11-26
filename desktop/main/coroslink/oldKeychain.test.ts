import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { askedNamesFile, cbcKey, corosLinkKeychain } from "./oldKeychain";

/** What Chromium's os_crypt writes on macOS/Linux: "v10"/"v11" + AES-128-CBC, IV of 16 spaces. */
function sealCbc(text: string, password: string, rounds: number, prefix = "v10"): string {
  const cipher = createCipheriv("aes-128-cbc", cbcKey(password, rounds), Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from(prefix), cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

/** What it writes on Windows: "v10" + nonce + AES-256-GCM + tag. */
function sealGcm(text: string, key: Buffer): string {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("v10"), nonce, body, cipher.getAuthTag()]).toString("base64");
}

describe("CorosLink's keychain", () => {
  it("opens a macOS value with the keychain password, asking once", async () => {
    let asked = 0;
    const keychain = corosLinkKeychain({ platform: "darwin", folder: "/nowhere", secret: async () => { asked++; return "s3cret-password"; } });
    expect(await keychain.open(sealCbc('{"account":"a"}', "s3cret-password", 1003))).toBe('{"account":"a"}');
    expect(await keychain.open(sealCbc("two", "s3cret-password", 1003))).toBe("two");
    expect(asked).toBe(1);
  });

  it("opens values a development CorosLink sealed under \"coroslink\", asking each name once", async () => {
    const asked: string[] = [];
    const passwords: Record<string, string> = { CorosLink: "packaged-password", coroslink: "development-password" };
    const keychain = corosLinkKeychain({ platform: "darwin", folder: "/nowhere", secret: async (name) => { asked.push(name); return passwords[name]; } });
    expect(await keychain.open(sealCbc("from dev", "development-password", 1003))).toBe("from dev");
    expect(await keychain.open(sealCbc("from app", "packaged-password", 1003))).toBe("from app");
    expect(await keychain.open(sealCbc("again", "development-password", 1003))).toBe("again");
    expect(asked).toEqual(["CorosLink", "coroslink"]);
  });

  it("in a shipped Mac build, opens CorosLink's values in-process and never asks the system", async () => {
    let asked = 0;
    const keychain = corosLinkKeychain({
      platform: "darwin", folder: "/nowhere", names: [], secret: async () => { asked++; return "x"; },
      own: async (data) => { if (data.toString() !== "sealed-by-corosLink") throw new Error("no"); return "opened"; },
    });
    expect(await keychain.open(Buffer.from("sealed-by-corosLink").toString("base64"))).toBe("opened");
    // Sealed under the development name: not opened, and no prompt.
    expect(await keychain.open(sealCbc("dev", "development-password", 1003))).toBeNull();
    expect(asked).toBe(0);
  });

  it("asks for a name on one launch only, even when the prompt is refused", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "keychain-")), "keychain-asked.json");
    let asked = 0;
    const launch = (answer: string | null) =>
      corosLinkKeychain({ platform: "darwin", folder: "", names: ["C-LINK"], asked: askedNamesFile(file), secret: async () => { asked++; return answer; } });
    // Refused on the first launch: not opened.
    expect(await launch(null).open(sealCbc("x", "dev-password", 1003))).toBeNull();
    // Later launches don't ask again, even for a value only that name opens.
    expect(await launch("dev-password").open(sealCbc("x", "dev-password", 1003))).toBeNull();
    expect(asked).toBe(1);
  });

  it("gives null, never throws, for a wrong password, a refused prompt or a value that isn't sealed", async () => {
    const wrong = corosLinkKeychain({ platform: "darwin", folder: "/nowhere", secret: async () => "other" });
    expect(await wrong.open(sealCbc("x", "right", 1003))).toBeNull();
    const refused = corosLinkKeychain({ platform: "darwin", folder: "/nowhere", secret: async () => null });
    expect(await refused.open(sealCbc("x", "right", 1003))).toBeNull();
    expect(await wrong.open(Buffer.from("plain text").toString("base64"))).toBeNull();
  });

  it("opens Windows GCM values with the Local State key", async () => {
    const key = randomBytes(32);
    const keychain = corosLinkKeychain({ platform: "win32", folder: "/nowhere", secret: async () => key });
    expect(await keychain.open(sealGcm("hevy-key", key))).toBe("hevy-key");
    const tampered = Buffer.from(sealGcm("hevy-key", key), "base64"); tampered[20] ^= 1;
    expect(await keychain.open(tampered.toString("base64"))).toBeNull();
  });

  it("opens Linux v10 (no keyring) and v11 (keyring) values", async () => {
    const keychain = corosLinkKeychain({ platform: "linux", folder: "/nowhere", secret: async () => "ring" });
    expect(await keychain.open(sealCbc("basic", "peanuts", 1))).toBe("basic");
    expect(await keychain.open(sealCbc("ringed", "ring", 1, "v11"))).toBe("ringed");
  });
});
