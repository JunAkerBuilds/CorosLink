#!/usr/bin/env node
// Development CLI: invoke the running CorosLink session; do not open a
// second BLE connection or read account credentials outside the app.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { title: "CorosLink", body: "Test value: 123" };
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (!["--title", "--message"].includes(flag) || process.argv[i + 1] === undefined) {
    throw new Error('Usage: node scripts/send-coros-notification.mjs --title "CorosLink" --message "Your message"');
  }
  options[flag === "--title" ? "title" : "body"] = process.argv[++i];
}

let enabledInspector = false;
let socket;
const calls = new Map();
let sequence = 0;
async function targets() {
  const response = await fetch("http://127.0.0.1:9229/json/list", { signal: AbortSignal.timeout(1000) });
  if (!response.ok) throw new Error("The app debugger is unavailable.");
  return response.json();
}

function enableAppInspector() {
  if (process.platform !== "darwin") throw new Error("This notification sender currently requires Mac Bluetooth.");
  const rows = execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" }).trim().split("\n");
  for (const row of rows) {
    const match = row.match(/^\s*(\d+)\s+(.+)$/);
    if (!match || !match[2].endsWith("/Electron.app/Contents/MacOS/Electron")) continue;
    const pid = Number(match[1]);
    const cwd = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    if (!cwd.split("\n").includes(`n${root}`)) continue;
    process.kill(pid, "SIGUSR1");
    enabledInspector = true;
    return;
  }
  throw new Error("Start CorosLink from this project and connect and authenticate your watch first.");
}

function evaluate(expression) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { calls.delete(id); reject(new Error("The app did not finish sending the message.")); }, 10000);
    calls.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

try {
  let list;
  try { list = await targets(); } catch {
    enableAppInspector();
    for (let i = 0; i < 10; i++) {
      try { list = await targets(); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
  }
  if (!list?.[0]?.webSocketDebuggerUrl) throw new Error("Could not reach the running CorosLink app.");
  socket = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Could not open the app debugger.")), 3000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not open the app debugger.")); }, { once: true });
  });
  socket.addEventListener("message", event => {
    const reply = JSON.parse(event.data);
    const call = calls.get(reply.id);
    if (!call) return;
    clearTimeout(call.timer); calls.delete(reply.id);
    if (reply.result?.exceptionDetails) call.reject(new Error(reply.result.exceptionDetails.exception?.description ?? "The app rejected the notification."));
    else if (reply.error) call.reject(new Error(reply.error.message));
    else call.resolve(reply.result?.result?.value);
  });
  const result = await evaluate(`(async()=>{
    const app=process.mainModule.require('electron').app;
    if(app.getAppPath()!==${JSON.stringify(root)})throw new Error('The debugger belongs to another app.');
    const ble=process.mainModule.require(${JSON.stringify(path.join(root, "dist-electron/corosNativeBleService.js"))}).corosNativeBle;
    if(typeof ble.sendNotification!=='function')throw new Error('Rebuild and restart CorosLink to load the notification sender.');
    return await ble.sendNotification(${JSON.stringify(options)});
  })()`);
  if (result?.sent !== true) throw new Error("The app did not confirm transport submission.");
  console.log(`Sent ${result.fragments} Bluetooth fragments. Check your watch for “${options.title} — ${options.body}”.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    if (enabledInspector) {
      await evaluate("setTimeout(()=>process.mainModule.require('node:inspector').close(),100); true").catch(() => {});
    }
    socket.close();
  }
}
