#!/usr/bin/env node
// A command-line Coach client for CorosLink's remote access: pairs with a
// pairing link the way C-LINK does (its own P-256 DPoP key), opens the
// WebSocket, subscribes to a conversation and sends. It's the end-to-end check
// without a phone.
//
//   node scripts/remote-client.mjs '<coroslink://remote/1?…#secret>' [options]
//   node scripts/remote-client.mjs --state <file> [options]     reuse a saved pairing
//
// Options:
//   --host <address>   connect here instead of the link's addresses (e.g. 127.0.0.1)
//   --label <name>     how CorosLink lists this client (default "remote-client")
//   --state <file>     save the key and session here after pairing, or load them
//   --session <id>     the conversation to open (default: the newest one)
//   --new              start a new conversation
//   --after <seq>      resume from this cursor instead of taking a snapshot
//   --send <text>      send one message, print the reply, and exit
//
// Without --send it reads messages from standard input, one per line.
// The pairing secret is never printed.
import crypto from "node:crypto";
import fs from "node:fs";
import readline from "node:readline";
import * as jose from "jose";
import WebSocket from "ws";

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${name} needs a value.`);
  args.splice(index, 2);
  return value;
}
function flag(name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function fail(message) {
  console.error(`remote-client: ${message}`);
  process.exit(1);
}

const hostOverride = option("--host");
const label = option("--label") ?? "remote-client";
const statePath = option("--state");
const sessionOption = option("--session");
const afterOption = option("--after");
const sendText = option("--send");
const startNew = flag("--new");
const link = args.find((value) => value.startsWith("coroslink://"));
if (!link && !(statePath && fs.existsSync(statePath))) {
  fail("Pass a pairing link (Coach settings → Remote access → Pair iPhone → Copy link), or --state with a saved pairing.");
}

const dim = (text) => (process.stdout.isTTY ? `\x1b[2m${text}\x1b[0m` : text);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("base64url");

// ----- The pairing link (CorosLink's encodeRemotePairingLink) -----

function parseLink(text) {
  const match = /^coroslink:\/\/remote\/1\?([^#]*)#([A-Za-z0-9_-]{43})$/.exec(text.trim());
  if (!match) fail("That isn't a CorosLink Coach pairing link.");
  const items = new Map(match[1].split("&").map((part) => {
    const at = part.indexOf("=");
    return [part.slice(0, at), decodeURIComponent(part.slice(at + 1))];
  }));
  const port = Number(items.get("p"));
  const hosts = (items.get("a") ?? "").split(",").filter(Boolean);
  if (!items.get("e") || !hosts.length || !Number.isInteger(port)) fail("That pairing link is incomplete.");
  return { environmentId: items.get("e"), hosts, port, name: items.get("n"), secret: match[2] };
}

// ----- HTTP with DPoP -----

async function proof(key, method, url, token) {
  const htu = new URL(url);
  htu.search = "";
  htu.hash = "";
  return new jose.SignJWT({
    htm: method,
    htu: htu.href,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomBytes(16).toString("base64url"),
    ...(token ? { ath: sha256(token) } : {})
  })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: key.publicJwk })
    .sign(key.privateKey);
}

async function call(baseUrl, path, { method = "GET", body, key, token, timeoutMs = 15_000 } = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { Accept: "application/json", "User-Agent": "CorosLink-remote-client/1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers.DPoP = await proof(key, method, url, token);
  if (token) headers.Authorization = `DPoP ${token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = new Error(json?.error?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.code = json?.error?.code;
    throw error;
  }
  return json;
}

// ----- Pair, or load a saved pairing -----

async function newKey() {
  const { publicKey, privateKey } = await jose.generateKeyPair("ES256", { extractable: true });
  const jwk = await jose.exportJWK(publicKey);
  return { privateKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

async function pickRoute(environmentId, hosts, port) {
  for (const host of hosts) {
    const baseUrl = `http://${host}:${port}`;
    try {
      const descriptor = await call(baseUrl, "/v1/descriptor", { timeoutMs: 3_000 });
      if (descriptor.environmentId !== environmentId) {
        console.error(dim(`${host}: a different computer answered.`));
        continue;
      }
      if (descriptor.protocol !== 1) fail(`${descriptor.name} speaks protocol ${descriptor.protocol}; this client speaks 1.`);
      return { baseUrl, descriptor };
    } catch (error) {
      console.error(dim(`${host}: ${error.message}`));
    }
  }
  fail("Couldn't reach the computer at any address in the link.");
}

let key;
let grant;
let baseUrl;
if (link) {
  const parsed = parseLink(link);
  const route = await pickRoute(parsed.environmentId, hostOverride ? [hostOverride] : parsed.hosts, parsed.port);
  baseUrl = route.baseUrl;
  key = await newKey();
  try {
    grant = await call(baseUrl, "/v1/auth/pair", { method: "POST", body: { secret: parsed.secret, label }, key });
  } catch (error) {
    fail(error.status === 401 ? "This code has expired or was already used. Show a new one in CorosLink." : error.message);
  }
  console.error(dim(`Paired with ${route.descriptor.name} (${baseUrl}) as "${label}": ${grant.permissions.join(", ")}`));
  if (statePath) {
    fs.writeFileSync(
      statePath,
      JSON.stringify({ baseUrl, environmentId: parsed.environmentId, privateJwk: await jose.exportJWK(key.privateKey), grant }, null, 2),
      { mode: 0o600 }
    );
  }
} else {
  const saved = JSON.parse(fs.readFileSync(statePath, "utf8"));
  baseUrl = hostOverride ? `http://${hostOverride}:${new URL(saved.baseUrl).port}` : saved.baseUrl;
  const descriptor = await call(baseUrl, "/v1/descriptor", { timeoutMs: 3_000 }).catch((error) => fail(error.message));
  if (descriptor.environmentId !== saved.environmentId) fail("A different computer answers at the saved address.");
  const { x, y, crv, kty } = saved.privateJwk;
  key = { privateKey: await jose.importJWK(saved.privateJwk, "ES256"), publicJwk: { kty, crv, x, y } };
  grant = saved.grant;
}

// ----- WebSocket RPC -----

let ticket;
try {
  ticket = await call(baseUrl, "/v1/auth/ws-ticket", { method: "POST", body: {}, key, token: grant.sessionToken });
} catch (error) {
  fail(error.status === 401 ? "This computer no longer accepts this client. Pair again." : error.message);
}
const wsUrl = `${baseUrl.replace(/^http/, "ws")}/v1/ws?ticket=${encodeURIComponent(ticket.ticket)}`;
const ws = new WebSocket(wsUrl, { headers: { "User-Agent": "CorosLink-remote-client/1" } });
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
}).catch((error) => fail(`Couldn't open the socket: ${error.message}`));

let nextId = 1;
const pending = new Map();
const waiters = new Set();
let sessionId;
let cursor = 0;

function rpc(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function printEvent(frame) {
  if (frame.sessionId !== sessionId) return;
  cursor = Math.max(cursor, frame.seq);
  const { event, data } = frame;
  switch (event) {
    case "turn.started":
      process.stdout.write(dim("\ncoach › "));
      break;
    case "turn.delta":
      process.stdout.write(data.delta);
      break;
    case "turn.thinking":
      process.stdout.write(dim(data.delta));
      break;
    case "turn.tool":
      process.stdout.write(dim(`\n[${data.status === "call" ? "using" : "failed"} ${data.tool ?? "a tool"}${data.message ? `: ${data.message}` : ""}]\n`));
      break;
    case "turn.completed":
      process.stdout.write(dim(`\n[done · seq ${frame.seq}]\n`));
      break;
    case "turn.failed":
      process.stdout.write(`\n[failed${data.authError ? " (sign-in needed)" : ""}: ${data.message}]\n`);
      break;
    case "entry.appended":
      if (data.entry.kind === "message" && data.entry.role === "user") {
        process.stdout.write(dim(`\nyou › ${data.entry.content}\n`));
      } else if (data.entry.kind !== "message") {
        process.stdout.write(dim(`\n[${data.entry.kind} card at #${data.index}]\n`));
      }
      break;
    case "session.updated":
      process.stdout.write(dim(`\n[title: ${data.session.title}]\n`));
      break;
    default:
      break;
  }
  for (const waiter of [...waiters]) waiter(frame);
}

ws.on("message", (raw) => {
  const frame = JSON.parse(raw.toString());
  if (frame.event) {
    printEvent(frame);
    return;
  }
  const entry = pending.get(frame.id);
  if (!entry) return;
  pending.delete(frame.id);
  if (frame.error) {
    const error = new Error(frame.error.message);
    Object.assign(error, frame.error);
    entry.reject(error);
  } else {
    entry.resolve(frame.result);
  }
});
ws.on("close", (code, reason) => {
  console.error(dim(`\nSocket closed (${code}${reason.length ? `: ${reason}` : ""}).`));
  process.exit(code === 1000 ? (process.exitCode ?? 0) : 2);
});

// ----- Session, subscribe, send -----

function describeEntry(entry) {
  if (entry.kind === "message") return `${entry.role === "user" ? "you" : "coach"} › ${entry.content.slice(0, 160)}`;
  return `[${entry.kind}]`;
}

try {
  if (startNew) {
    sessionId = (await rpc("coach.createSession")).session.id;
  } else if (sessionOption) {
    sessionId = sessionOption;
  } else {
    const { sessions } = await rpc("coach.listSessions");
    sessionId = sessions[0]?.id ?? (await rpc("coach.createSession")).session.id;
  }
  const after = afterOption === undefined ? undefined : Number(afterOption);
  const subscribed = await rpc("coach.subscribe", { sessionId, ...(after === undefined ? {} : { afterSeq: after }) });
  if (subscribed.mode === "snapshot") {
    const { snapshot } = subscribed;
    cursor = snapshot.cursor;
    console.error(dim(`"${snapshot.session.title}" (${snapshot.session.provider}) · ${snapshot.entries.length} entries · cursor ${cursor}`));
    for (const entry of snapshot.entries.slice(-6)) console.error(dim(describeEntry(entry)));
    if (snapshot.activeTurn) process.stdout.write(dim("\ncoach › ") + snapshot.activeTurn.text);
  } else {
    cursor = after;
    console.error(dim(`Resuming after seq ${after}.`));
  }
} catch (error) {
  fail(error.message);
}

async function send(text) {
  const clientMessageId = crypto.randomUUID();
  // The turn can end before coach.send's answer arrives, so listen first.
  const endings = new Map();
  let wanted;
  let settle;
  const ended = new Promise((resolve) => { settle = resolve; });
  const waiter = (frame) => {
    if (frame.event !== "turn.completed" && frame.event !== "turn.failed") return;
    endings.set(frame.data.requestId, frame.event);
    if (frame.data.requestId === wanted) settle(frame.event);
  };
  waiters.add(waiter);
  try {
    wanted = (await rpc("coach.send", { sessionId, clientMessageId, text })).requestId;
    if (endings.has(wanted)) settle(endings.get(wanted));
    return await ended;
  } catch (error) {
    console.error(`\n[refused: ${error.message}${error.requiredPermission ? ` (needs ${error.requiredPermission})` : ""}]`);
    return "refused";
  } finally {
    waiters.delete(waiter);
  }
}

if (sendText !== undefined) {
  const outcome = await send(sendText);
  ws.close(1000);
  process.exitCode = outcome === "turn.completed" ? 0 : 1;
} else {
  console.error(dim("Type a message and press Return. Ctrl-D quits."));
  const lines = readline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (line.trim()) await send(line.trim());
  }
  ws.close(1000);
}
