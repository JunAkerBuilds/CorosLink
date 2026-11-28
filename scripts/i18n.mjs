// The translation catalogs (src/lib/i18n/<lang>/*.json): finds every English line the code passes to t, tx, tr or msg
// and says which a language is missing, or where a translation drops a {placeholder}.
//   node scripts/i18n.mjs check [path…]   lines missing in es / de / pt-BR / pt-PT / zh-Hans (all of src and desktop when no path)
//   node scripts/i18n.mjs conflicts       lines two catalog files translate differently
//   node scripts/i18n.mjs index           rewrites src/lib/i18n/catalogs/<lang>.ts from the json files
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = path.join(root, "src/lib/i18n");
export const LANGS = ["es", "de", "pt-BR", "pt-PT", "zh-Hans"];

function sourceFiles(target) {
  const full = path.resolve(root, target);
  if (statSync(full).isFile()) return /\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full) ? [full] : [];
  // The i18n module itself only shows t in its comments.
  if (full === i18nDir) return [];
  return readdirSync(full).flatMap((name) => (name === "node_modules" || name === "dist" ? [] : sourceFiles(path.join(full, name))));
}

const STRING = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\$])*\x60)`;
const CALL = new RegExp(String.raw`(?<![\w.$])(t|tr|msg)\(\s*${STRING}`, "g");
const CALL_CONTEXT = new RegExp(String.raw`(?<![\w.$])tx\(\s*${STRING}\s*,\s*${STRING}`, "g");

function unquote(literal) {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\n|.)/g, (_, c) => {
    if (c === "\n") return "";
    if (c[0] === "u") return String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ""), 16));
    if (c[0] === "x") return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: "\n", t: "\t", r: "\r" }[c] ?? c;
  });
}

/** Every English key the files ask for, with where each is first asked. */
export function keysIn(targets) {
  const keys = new Map();
  for (const file of targets.flatMap(sourceFiles)) {
    const text = readFileSync(file, "utf8");
    const at = (index) => `${path.relative(root, file)}:${text.slice(0, index).split("\n").length}`;
    for (const m of text.matchAll(CALL)) { const k = unquote(m[2]); if (!keys.has(k)) keys.set(k, at(m.index)); }
    for (const m of text.matchAll(CALL_CONTEXT)) { const k = `${unquote(m[1])}|${unquote(m[2])}`; if (!keys.has(k)) keys.set(k, at(m.index)); }
  }
  return keys;
}

/** The json files of a language, and all their lines merged. */
export function catalog(lang) {
  const dir = path.join(i18nDir, lang);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { /* none yet */ }
  const words = {};
  for (const f of files) Object.assign(words, JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  return { files, words };
}

const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

/** What's wrong for the given paths: keys a language lacks, and translations whose {placeholders} differ. */
export function problems(targets = ["src", "desktop"]) {
  const keys = keysIn(targets);
  const out = [];
  for (const lang of LANGS) {
    const { words } = catalog(lang);
    for (const [key, where] of keys) {
      const english = key.includes("|") && !(key in words) ? key.slice(key.indexOf("|") + 1) : key;
      const said = words[key] ?? words[english];
      if (said === undefined || said === "") out.push(`${lang} missing  ${JSON.stringify(key)}  (${where})`);
      else if (holes(said) !== holes(english)) out.push(`${lang} placeholders differ  ${JSON.stringify(key)} → ${JSON.stringify(said)}`);
    }
  }
  return out;
}

/** Lines two catalog files of one language translate differently (the one loaded last would win). */
export function conflicts() {
  const out = [];
  for (const lang of LANGS) {
    const seen = new Map();
    for (const f of catalog(lang).files) {
      for (const [k, v] of Object.entries(JSON.parse(readFileSync(path.join(i18nDir, lang, f), "utf8")))) {
        const before = seen.get(k);
        if (before && before.v !== v) out.push(`${lang} ${JSON.stringify(k)}: ${before.f} ${JSON.stringify(before.v)} ≠ ${f} ${JSON.stringify(v)}`);
        else if (!before) seen.set(k, { f, v });
      }
    }
  }
  return out;
}

export function writeIndex() {
  for (const lang of LANGS) {
    const { files } = catalog(lang);
    const names = files.map((f, i) => ({ f, id: `c${i}` }));
    const text = `// Written by scripts/i18n.mjs from src/lib/i18n/${lang}. Don't edit.\nimport type { Catalog } from "../index";\n` +
      names.map(({ f, id }) => `import ${id} from "../${lang}/${f}";\n`).join("") +
      `\nconst words: Catalog = { ${names.map(({ id }) => `...${id}`).join(", ")} };\nexport default words;\n`;
    writeFileSync(path.join(i18nDir, "catalogs", `${lang}.ts`), text);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "conflicts") {
    const found = conflicts();
    console.log(found.length ? found.join("\n") : "no conflicts");
    process.exitCode = found.length ? 1 : 0;
  } else if (cmd === "index") { writeIndex(); console.log("catalogs written"); }
  else if (cmd === "check") {
    const found = problems(rest.length ? rest : undefined);
    console.log(found.length ? found.join("\n") : "nothing missing");
    process.exitCode = found.length ? 1 : 0;
  } else { console.log("usage: node scripts/i18n.mjs check [path…] | conflicts | index"); process.exitCode = 2; }
}
