import { describe, expect, it } from "vitest";
import { bcryptHash, bcryptSalt } from "./bcrypt";

describe("bcrypt", () => {
  // The vectors CorosKit's BCrypt is tested with: bcryptjs 3.0.3's answers, the last OpenBSD's own.
  it("matches bcryptjs", () => {
    expect(bcryptHash("5f4dcc3b5aa765d61d8327deb882cf99", "$2b$10$eNR3rwqkj3p0sDuarsBKTu")).toBe("$2b$10$eNR3rwqkj3p0sDuarsBKTuXkTnmX9oPVUVZuJj/hmU4nU41iNCtFe");
    expect(bcryptHash("", "$2b$04$abcdefghijklmnopqrstuu")).toBe("$2b$04$abcdefghijklmnopqrstuubyCG3zY1GIXMyxfivm.ClDiInHzxjiq");
    expect(bcryptHash("U*U", "$2a$05$CCCCCCCCCCCCCCCCCCCCC.")).toBe("$2a$05$CCCCCCCCCCCCCCCCCCCCC.E5YPO9kmyuRGyh0XouQYb4YMJKvyOeW");
  });

  it("refuses a malformed salt", () => {
    expect(bcryptHash("x", "$3$10$abc")).toBeNull();
    expect(bcryptHash("x", "$2b$10$short")).toBeNull();
    expect(bcryptHash("x", "$2b$99$abcdefghijklmnopqrstuu")).toBeNull();
  });

  it("makes salts of the right shape", () => {
    const salt = bcryptSalt(10);
    expect(salt.startsWith("$2b$10$")).toBe(true);
    expect(salt).toHaveLength(29);
    expect(bcryptSalt(4)).not.toBe(bcryptSalt(4));
    expect(bcryptHash("a", bcryptSalt(4))).toHaveLength(60);
  });
});
