// bcrypt (`$2b$`), as bcryptjs computes it. Ported from CorosKit's BCrypt.swift. COROS Training Hub's web
// sign-in sends bcrypt(md5(password), salt) and the salt, never the password itself.
import { randomBytes } from "node:crypto";
import { INITIAL_P, INITIAL_S } from "./bcryptTables";

const ALPHABET = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** "OrpheanBeholderScryDoubt", the text bcrypt encrypts. */
const MAGIC = [0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274];

/** A new `$2b$<cost>$<22 chars>` salt from the system's random source. */
export function bcryptSalt(cost = 10, bytes: Uint8Array = randomBytes(16)): string {
  const rounds = Math.min(Math.max(Math.trunc(cost), 4), 31);
  return "$2b$" + (rounds < 10 ? "0" : "") + rounds + "$" + encode(bytes, 16);
}

/** The full bcrypt string for `password` with `salt` (`$2a$`/`$2b$`/`$2y$`), or null for a malformed salt. */
export function bcryptHash(password: string, salt: string): string | null {
  const parts = salt.split("$");
  if (parts.length !== 4 || parts[0] !== "" || !["2a", "2b", "2y"].includes(parts[1])) return null;
  if (!/^\d{1,2}$/.test(parts[2])) return null;
  const cost = Number(parts[2]);
  if (cost < 4 || cost > 31 || parts[3].length < 22) return null;
  const saltBytes = decode(parts[3].slice(0, 22), 16);
  if (!saltBytes) return null;

  const utf8 = new TextEncoder().encode(password).subarray(0, 72);
  let key = new Uint8Array(utf8.length + 1);
  key.set(utf8);
  if (key.length > 72) key = key.subarray(0, 72);

  const state = new State();
  state.expand(key, saltBytes);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    state.expand(key, null);
    state.expand(saltBytes, null);
  }
  const text = MAGIC.slice();
  for (let round = 0; round < 64; round++) {
    for (let i = 0; i < text.length; i += 2) {
      state.encrypt(text[i], text[i + 1]);
      text[i] = state.l;
      text[i + 1] = state.r;
    }
  }
  const bytes = new Uint8Array(24);
  text.forEach((word, i) => {
    bytes[i * 4] = word >>> 24; bytes[i * 4 + 1] = (word >>> 16) & 0xff; bytes[i * 4 + 2] = (word >>> 8) & 0xff; bytes[i * 4 + 3] = word & 0xff;
  });
  return `$${parts[1]}$${parts[2]}$` + encode(saltBytes, 16) + encode(bytes, 23);
}

// bcrypt's base64 (its own alphabet, no padding)

function encode(bytes: Uint8Array, count: number): string {
  let out = "";
  let index = 0;
  while (index < count) {
    const c1 = bytes[index++];
    out += ALPHABET[(c1 >> 2) & 0x3f];
    let carry = (c1 & 0x03) << 4;
    if (index >= count) { out += ALPHABET[carry & 0x3f]; break; }
    const c2 = bytes[index++];
    carry |= (c2 >> 4) & 0x0f;
    out += ALPHABET[carry & 0x3f];
    carry = (c2 & 0x0f) << 2;
    if (index >= count) { out += ALPHABET[carry & 0x3f]; break; }
    const c3 = bytes[index++];
    carry |= (c3 >> 6) & 0x03;
    out += ALPHABET[carry & 0x3f];
    out += ALPHABET[c3 & 0x3f];
  }
  return out;
}

function decode(text: string, count: number): Uint8Array | null {
  const value = (position: number): number | null => {
    if (position >= text.length) return null;
    const found = ALPHABET.indexOf(text[position]);
    return found < 0 ? null : found;
  };
  const out: number[] = [];
  let position = 0;
  while (out.length < count) {
    const c1 = value(position), c2 = value(position + 1);
    if (c1 === null || c2 === null) return null;
    position += 2;
    out.push(((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff);
    if (out.length >= count) break;
    const c3 = value(position);
    if (c3 === null) return null;
    position += 1;
    out.push((((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff);
    if (out.length >= count) break;
    const c4 = value(position);
    if (c4 === null) return null;
    position += 1;
    out.push((((c3 & 0x03) << 6) | c4) & 0xff);
  }
  return Uint8Array.from(out);
}

// Eksblowfish

class State {
  p = Uint32Array.from(INITIAL_P);
  s = Uint32Array.from(INITIAL_S);
  /** The last `encrypt` result (two fields instead of a tuple: this runs millions of times). */
  l = 0;
  r = 0;
  private offset = 0;

  private f(x: number): number {
    const s = this.s;
    return ((((s[x >>> 24] + s[256 + ((x >>> 16) & 0xff)]) ^ s[512 + ((x >>> 8) & 0xff)]) >>> 0) + s[768 + (x & 0xff)]) >>> 0;
  }

  encrypt(left: number, right: number): void {
    const p = this.p;
    let l = (left ^ p[0]) >>> 0;
    let r = right >>> 0;
    for (let round = 1; round <= 16; round += 2) {
      r = (r ^ this.f(l) ^ p[round]) >>> 0;
      l = (l ^ this.f(r) ^ p[round + 1]) >>> 0;
    }
    this.l = (r ^ p[17]) >>> 0;
    this.r = l;
  }

  private word(data: Uint8Array): number {
    let word = 0;
    for (let i = 0; i < 4; i++) {
      word = ((word << 8) | data[this.offset]) >>> 0;
      this.offset = (this.offset + 1) % data.length;
    }
    return word;
  }

  expand(key: Uint8Array, salt: Uint8Array | null): void {
    this.offset = 0;
    for (let i = 0; i < 18; i++) this.p[i] = (this.p[i] ^ this.word(key)) >>> 0;
    this.offset = 0;
    let left = 0, right = 0;
    for (let i = 0; i < 18; i += 2) {
      if (salt) { left = (left ^ this.word(salt)) >>> 0; right = (right ^ this.word(salt)) >>> 0; }
      this.encrypt(left, right);
      left = this.l; right = this.r;
      this.p[i] = left; this.p[i + 1] = right;
    }
    for (let i = 0; i < 1024; i += 2) {
      if (salt) { left = (left ^ this.word(salt)) >>> 0; right = (right ^ this.word(salt)) >>> 0; }
      this.encrypt(left, right);
      left = this.l; right = this.r;
      this.s[i] = left; this.s[i + 1] = right;
    }
  }
}
