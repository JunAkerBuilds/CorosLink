// `CLINK_SMOKE_ACTIVITY_SCREENS=1` (with CLINK_SMOKE): Developer → Activity screens with a simulated PACE Pro (no watch
// is touched; main.ts uses `simulatedPacePro` only in this smoke). Reads Run's four pages, syncs them unchanged,
// confirms, previews five fields on page 2 and syncs it, then restores the baseline. Shots are `activity-screens-*.png`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";
import golden from "./watch/fixtures/activityScreensGolden.json";
import type { ActivityScreensDeps } from "./watch/activityScreens";

/** A PACE Pro on firmware 3.2008.0 with Run's pages as the real one sent them (the test fixture). */
export function simulatedPacePro(): Pick<ActivityScreensDeps, "link" | "exchange"> {
  let pages = Buffer.from(golden.source, "hex");
  return {
    link: () => ({ device: { key: "COROS PACE Pro SIM", name: "PACE Pro (simulated)", model: "PACE Pro", firmware: "V 3.2008.0" }, session: "smoke" }),
    exchange: async (op, payload) => {
      await new Promise((r) => setTimeout(r, 300));
      if (op === "read") return payload[0] === 255 ? Buffer.from([0, 5, 4, 64]) : Buffer.from(pages);
      pages = Buffer.from(payload);
      return Buffer.from([1]);
    },
  };
}

export async function smokeActivityScreens(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const shot = async (name: string) => {
    window.webContents.invalidate();
    await wait(500);
    try { writeFileSync(path.join(folder, `activity-screens-${name}.png`), (await window.webContents.capturePage()).toPNG()); } catch (error) { log.push(`screenshot failed: ${String(error)}`); }
  };
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const click = (text: string) => run(`(() => { const b = [...document.querySelectorAll(".as button")].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b && !b.disabled; })()`);
  const idle = () => until(`!document.querySelector(".as[aria-busy=true]")`, 20);
  const say = (line: string) => log.push(`--- activity screens: ${line}`);

  await window.loadURL(`${origin}/developer`);
  say(`section ${await until(`document.querySelector(".as")`, 15)}`);
  await shot("start");
  say(`read ${await click("Read pages")}`); await idle();
  await wait(400);
  await shot("read");
  say(`sync unchanged ${await click("Sync unchanged")}`); await idle();
  say(`confirm ${await click("They match on the watch")}`); await idle();
  say(`page 2 ${await run(`(() => { const b = document.querySelectorAll(".as-pages button")[1]; b?.click(); return !!b; })()`)}`);
  await run(`(() => { const s = document.querySelector(".as-layout select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "5"); s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await wait(300);
  say(`preview ${await click("Preview")}`); await idle();
  await wait(300);
  await shot("preview");
  say(`sync preview ${await click("Sync to watch")}`); await idle();
  await wait(300);
  await shot("synced");
  say(`pages now ${await run(`[...document.querySelectorAll(".as-pages button span:last-child")].map((s) => s.textContent).join(", ")`)}`);
  say(`back to baseline ${await click("Back to baseline")}`); await idle();
  say(`pages after ${await run(`[...document.querySelectorAll(".as-pages button span:last-child")].map((s) => s.textContent).join(", ")`)}; note: ${await run(`document.querySelector(".as-ok, .as-error")?.textContent`)}`);
  say(`backups ${await run(`document.querySelectorAll(".as-backups option").length - 1`)}`);
  await shot("restored");
}
