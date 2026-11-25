import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5";

describe("md5Hex", () => {
  it("matches the RFC 1321 test suite", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")).toBe("d174ab98d277d9f5a5611c2c9f419d9f");
    expect(md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });

  it("matches the phone app's hash of a password", () => {
    // TrainingHub.passwordHash("password") in CorosKit's tests.
    expect(md5Hex("password")).toBe("5f4dcc3b5aa765d61d8327deb882cf99");
  });

  it("hashes UTF-8 bytes and every padding length like Node's MD5", () => {
    const samples = ["pässwörd", "密码🔐", ...Array.from({ length: 130 }, (_, n) => "x".repeat(n))];
    for (const sample of samples) expect(md5Hex(sample)).toBe(createHash("md5").update(sample, "utf8").digest("hex"));
  });
});
