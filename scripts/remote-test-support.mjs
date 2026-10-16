// Shared by scripts/test-remote-auth.mjs and scripts/test-remote-server.mjs.
// Both run under Electron as Node (ELECTRON_RUN_AS_NODE=1), so better-sqlite3
// loads with the ABI it was built for and the real remote_* tables are tested.
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import * as jose from "jose";

export const repoRoot = path.resolve(import.meta.dirname, "..");
export const requireDist = createRequire(path.join(repoRoot, "dist-electron", "main.js"));

export { jose };

/** An in-memory database with the remote access tables, as initializeDatabase makes them. */
export function createRemoteDatabase() {
  const Database = requireDist("better-sqlite3");
  const { createRemoteAccessTables } = requireDist("./database.js");
  const db = new Database(":memory:");
  createRemoteAccessTables(db);
  return db;
}

/** safeStorage stand-in: reversible, and visibly not plain text. */
export function createFakeSecretBox({ available = true } = {}) {
  return {
    available,
    ensureAvailable() {
      if (!this.available) throw new Error("Secure credential storage is unavailable.");
    },
    encrypt: (plain) => Buffer.from(`enc:${Buffer.from(plain).toString("base64")}`),
    decrypt: (encrypted) => Buffer.from(encrypted.toString().slice(4), "base64").toString()
  };
}

export function createSettings() {
  const values = new Map();
  return { values, get: (key) => values.get(key), set: (key, value) => values.set(key, value) };
}

export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("base64url");

/** A device key, as C-LINK's DPoPKey makes one. */
export async function createDeviceKey() {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
  const jwk = await jose.exportJWK(publicKey);
  const publicJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  return { privateKey, publicJwk, jkt: await jose.calculateJwkThumbprint(publicJwk, "sha256") };
}

/** An RFC 9449 proof. Every part can be overridden to build a bad one. */
export async function createProof(key, {
  method = "POST",
  url,
  token,
  iat = Math.floor(Date.now() / 1000),
  jti = crypto.randomBytes(16).toString("base64url"),
  typ = "dpop+jwt",
  alg = "ES256",
  jwk = key.publicJwk,
  claims = {},
  signingKey = key.privateKey
}) {
  const htu = new URL(url);
  htu.search = "";
  htu.hash = "";
  const payload = { htm: method, htu: htu.href, iat, jti, ...(token ? { ath: sha256(token) } : {}), ...claims };
  for (const [name, value] of Object.entries(payload)) if (value === undefined || value === null) delete payload[name];
  return new jose.SignJWT(payload).setProtectedHeader({ alg, typ, ...(jwk ? { jwk } : {}) }).sign(signingKey);
}

/** A raw HTTP request, so tests can send any Host or Origin header. */
export function request(port, { method = "GET", path: requestPath = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const outgoing = http.request(
      {
        host: "127.0.0.1",
        port,
        // A fresh connection each time: rebinding (Network access) drops pooled ones.
        agent: false,
        method,
        path: requestPath,
        headers: {
          Host: `127.0.0.1:${port}`,
          ...(payload !== undefined ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = text ? JSON.parse(text) : undefined;
          } catch {
            json = undefined;
          }
          resolve({ status: response.statusCode, headers: response.headers, text, json });
        });
      }
    );
    outgoing.on("error", reject);
    if (payload !== undefined) outgoing.write(payload);
    outgoing.end();
  });
}

// ----- A Coach hub with a provider the test drives by hand (as in test-coach-hub.mjs) -----

export function createMemoryChatDatabase() {
  const rows = new Map();
  return {
    rows,
    listSessions: (provider) =>
      [...rows.values()]
        .filter((row) => row.provider === provider)
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()),
    getSession: (id) => rows.get(id),
    insertSession(id, provider, title, messagesJson, createdAt, updatedAt) {
      rows.set(id, { id, provider, title, messages_json: messagesJson, created_at: createdAt, updated_at: updatedAt });
    },
    updateSession(id, title, messagesJson, updatedAt) {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, title, messages_json: messagesJson, updated_at: updatedAt });
    },
    deleteSession: (id) => rows.delete(id)
  };
}

export function createFakeStream() {
  const turns = [];
  return {
    turns,
    start(sink, requestId, messages, unitSystem, provider) {
      let resolve;
      const done = new Promise((settle) => { resolve = settle; });
      turns.push({
        requestId, messages, unitSystem, provider, resolve,
        send: (channel, payload = {}) => sink.send(channel, { requestId, ...payload })
      });
      return done;
    },
    cancel(requestId) {
      const turn = turns.find((candidate) => candidate.requestId === requestId);
      turn?.send("chat:streamDone", { fullText: "partial", finishReason: "cancelled" });
      turn?.resolve();
    }
  };
}

export function createHub() {
  const { CoachSessionHub } = requireDist("./coachHub/coachSessionHub.js");
  const { createChatHistorySessionStore, createMemoryCoachEventStore } = requireDist("./coachHub/coachStores.js");
  const stream = createFakeStream();
  const unsupported = async () => { throw new Error("not in this test"); };
  const hub = new CoachSessionHub({
    sessions: createChatHistorySessionStore(createMemoryChatDatabase()),
    events: createMemoryCoachEventStore(),
    stream,
    actions: {
      confirmCorosAction: unsupported,
      confirmWorkoutDelete: unsupported,
      uploadPlanDraft: unsupported,
      strengthEditStatus: unsupported,
      confirmStrengthEdit: unsupported,
      cancelStrengthEdit: unsupported
    },
    settings: () => ({ visualizationsEnabled: true })
  });
  return { hub, stream };
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

export async function waitFor(predicate, { timeoutMs = 3_000, message = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
