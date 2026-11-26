import { describe, expect, it } from "vitest";
import { compareVersions, pickInstall, programNames, registryPathDirs, shimCommand } from "./cli";

const NPM_DIR = "C:\\Users\\athlete\\AppData\\Roaming\\npm";

/** npm's cmd-shim for a package whose bin is a node script. */
const NPM_NODE_SHIM = [
  "@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "",
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', "  SET PATHEXT=%PATHEXT:;.JS;=;%", ")", "",
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");

/** npm's cmd-shim for a package whose bin is a program of its own. */
const NPM_EXE_SHIM = ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0",
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*'].join("\r\n");

describe("programNames", () => {
  it("tries the installer's .exe before npm's .cmd on Windows", () => expect(programNames("claude", "win32")).toEqual(["claude.exe", "claude.cmd", "claude.bat"]));
  it("is the bare name elsewhere", () => expect(programNames("claude", "darwin")).toEqual(["claude"]));
});

// Node won't start a .cmd without a shell (and a shell would break Coach's arguments): the "Not signed in" and
// "Sign-in took too long" on Windows with Claude Code installed through npm.
describe("shimCommand", () => {
  const shim = `${NPM_DIR}\\claude.cmd`;

  it("runs an npm node script with the node beside the shim when there is one", () => {
    expect(shimCommand(NPM_NODE_SHIM, shim, { exists: (f) => f === `${NPM_DIR}\\node.exe`, node: () => null }))
      .toEqual({ file: `${NPM_DIR}\\node.exe`, args: [`${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`] });
  });

  it("otherwise with the node on the search path", () => {
    expect(shimCommand(NPM_NODE_SHIM, shim, { exists: () => false, node: () => "C:\\Program Files\\nodejs\\node.exe" }))
      .toEqual({ file: "C:\\Program Files\\nodejs\\node.exe", args: [`${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`] });
  });

  it("starts a program the shim points to directly", () => {
    expect(shimCommand(NPM_EXE_SHIM, shim, { exists: () => false, node: () => null }))
      .toEqual({ file: `${NPM_DIR}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`, args: [] });
  });

  it("reads pnpm's %~dp0 form", () => {
    const text = '@SETLOCAL\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" "%~dp0\\global\\5\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*\r\n)';
    const dir = "C:\\Users\\athlete\\AppData\\Local\\pnpm";
    expect(shimCommand(text, `${dir}\\gemini.cmd`, { exists: () => false, node: () => "C:\\node\\node.exe" }))
      .toEqual({ file: "C:\\node\\node.exe", args: [`${dir}\\global\\5\\node_modules\\@google\\gemini-cli\\dist\\index.js`] });
  });

  it("gives up on a script without node, or a file that isn't a shim", () => {
    expect(shimCommand(NPM_NODE_SHIM, shim, { exists: () => false, node: () => null })).toBeNull();
    expect(shimCommand("@echo off\r\nclaude-wrapper.ps1 %*", shim, { exists: () => false, node: () => null })).toBeNull();
    expect(shimCommand("", shim)).toBeNull();
  });
});

describe("pickInstall", () => {
  it("takes the newest of several installs", () => {
    expect(pickInstall([{ file: "/usr/local/bin/claude", version: "2.1.3 (Claude Code)" }, { file: "/home/a/.local/bin/claude", version: "2.1.332 (Claude Code)" }], "linux"))
      .toBe("/home/a/.local/bin/claude");
  });
  it("prefers a .exe over a shim of the same version on Windows", () => {
    const npm = { file: "C:\\npm\\claude.cmd", version: "2.1.332" }, exe = { file: "C:\\bin\\claude.exe", version: "2.1.332" };
    expect(pickInstall([npm, exe], "win32")).toBe(exe.file);
    expect(pickInstall([npm, exe], "linux")).toBe(npm.file);
  });
  it("keeps the search order when versions are unknown", () => {
    expect(pickInstall([{ file: "a" }, { file: "b" }], "darwin")).toBe("a");
    expect(pickInstall([], "darwin")).toBeNull();
  });
  it("orders versions by number, not text", () => {
    expect(compareVersions("2.10.0", "2.9.9")).toBe(1);
    expect(compareVersions("2.1", "2.1.0")).toBe(-1);
    expect(compareVersions(undefined, "0.0.1")).toBe(-1);
  });
});

// A PATH changed after C-LINK started is read from Windows' saved settings.
describe("registryPathDirs", () => {
  const env = { USERPROFILE: "C:\\Users\\athlete", SystemRoot: "C:\\Windows" };
  it("reads the folders, filling in variables", () => {
    const out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;%systemroot%\\system32;;C:\\Tools\r\n\r\n";
    expect(registryPathDirs(out, env)).toEqual(["C:\\Users\\athlete\\.local\\bin", "C:\\Windows\\system32", "C:\\Tools"]);
  });
  it("drops a folder with a variable it can't fill, and reads nothing from an error", () => {
    expect(registryPathDirs("    Path    REG_SZ    %NOPE%\\bin;D:\\x", env)).toEqual(["D:\\x"]);
    expect(registryPathDirs("", env)).toEqual([]);
  });
});
