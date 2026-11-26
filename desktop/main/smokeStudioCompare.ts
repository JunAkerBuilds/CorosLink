// `CLINK_SMOKE_STUDIO_COMPARE=<project id>` (with CLINK_SMOKE): every layer's inspector on one saved face, for comparing
// with CorosLink's Studio side by side. Put a CorosLink project folder (project.json, starter.dat, preview.png) in
// `<CLINK_USER_DATA>/studio/projects/<id>` first. For each Layers row it opens every fold and saves the inspector at its
// full height as `compare/<nn>-<layer>.png` with its text and controls in a `.txt` beside it; a live-data field gets
// one more pair per part. The Face tab is `compare/00-face`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

export async function smokeStudioCompare(window: BrowserWindow, origin: string, folder: string, log: string[]): Promise<void> {
  const id = process.env.CLINK_SMOKE_STUDIO_COMPARE!;
  const out = path.join(folder, "compare");
  mkdirSync(out, { recursive: true });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const run = (code: string) => window.webContents.executeJavaScript(code).catch((e: unknown) => `failed: ${String(e)}`);
  const until = async (code: string, seconds: number) => {
    for (let i = 0; i < seconds * 4; i++) { if (await run(`!!(${code})`) === true) return true; await wait(250); }
    return false;
  };
  const [width, height] = window.getContentSize();
  const shoot = async (name: string) => {
    await run(`document.querySelectorAll(".st-right details").forEach((d) => { d.open = true; })`);
    await wait(300);
    const tall = Number(await run(`(() => { const p = document.querySelector(".st-right"); return Math.max(p.scrollHeight, ...[...p.querySelectorAll("*")].map((e) => e.scrollHeight)); })()`)) || height;
    window.setContentSize(width, Math.min(8000, Math.max(height, tall + 200)));
    await run(`(() => { const p = document.querySelector(".st-right"); p.style.maxHeight = "none"; p.style.height = "auto"; p.style.overflow = "visible";
      p.querySelectorAll("*").forEach((e) => { if (e.scrollHeight > e.clientHeight + 4) { e.style.maxHeight = "none"; e.style.height = "auto"; e.style.overflow = "visible"; } }); })()`);
    await wait(600);
    window.webContents.invalidate();
    await wait(300);
    const rect = await run(`(() => { const p = document.querySelector(".st-right"), r = p.getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(Math.max(r.height, p.scrollHeight)) }; })()`) as Electron.Rectangle;
    try { writeFileSync(path.join(out, `${name}.png`), (await window.webContents.capturePage(rect)).toPNG()); } catch (error) { log.push(`compare: shot ${name} failed: ${String(error)}`); }
    const text = await run(`(() => { const p = document.querySelector(".st-right");
      const fields = [...p.querySelectorAll("input,select,textarea,button,[role=switch]")].map((e) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.textContent || e.placeholder || "").trim().replace(/\\s+/g, " ")).filter(Boolean);
      return p.innerText + "\\n\\n--- controls ---\\n" + [...new Set(fields)].join("\\n"); })()`);
    writeFileSync(path.join(out, `${name}.txt`), String(text));
    window.setContentSize(width, height);
    await run(`(() => { const p = document.querySelector(".st-right"); p.removeAttribute("style"); p.querySelectorAll("[style]").forEach((e) => { if (e.style.overflow === "visible") { e.style.removeProperty("max-height"); e.style.removeProperty("height"); e.style.removeProperty("overflow"); } }); })()`);
    await wait(200);
  };

  await window.loadURL(`${origin}/studio/${id}`);
  if (!await until(`document.querySelectorAll(".st-layer-pick").length > 3`, 60)) { log.push(`compare: editor didn't open ${id}`); return; }
  await wait(2500);
  await run(`[...document.querySelectorAll(".st-right .seg button")].find((b) => b.textContent.trim() === "Face")?.click()`);
  await wait(800);
  await shoot("00-face");
  await run(`[...document.querySelectorAll(".st-right .seg button")].find((b) => b.textContent.trim() === "Layer")?.click()`);
  await wait(400);
  const rows = JSON.parse(String(await run(`JSON.stringify([...document.querySelectorAll(".st-layer-pick")].map((b) => b.innerText.split("\\n")[0].trim()))`))) as string[];
  writeFileSync(path.join(out, "_layers.txt"), rows.join("\n"));
  for (let i = 0; i < rows.length; i++) {
    const name = `${String(i + 1).padStart(2, "0")}-${slug(rows[i]!)}`;
    const ok = await run(`(() => { const b = document.querySelectorAll(".st-layer-pick")[${i}]; if (!b) return false; b.scrollIntoView({ block: "center" }); b.click(); return true; })()`);
    if (ok !== true) continue;
    await wait(900);
    await shoot(name);
    // A live-data field shows one part at a time: each part's own settings.
    const parts = JSON.parse(String(await run(`JSON.stringify([...(document.querySelector('.st-right [role=group][aria-label="Part"]')?.querySelectorAll("button") ?? [])].map((b) => b.textContent.trim()))`))) as string[];
    for (const [k, part] of parts.entries()) {
      if (k === 0) continue;
      await run(`[...document.querySelector('.st-right [role=group][aria-label="Part"]').querySelectorAll("button")][${k}].click()`);
      await wait(700);
      await shoot(`${name}--${slug(part)}`);
    }
  }
  log.push(`--- studio compare: ${rows.length} layers into ${out}`);
}
