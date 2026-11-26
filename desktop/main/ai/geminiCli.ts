// Gemini CLI: Coach answered through the athlete's installed `gemini`, signed in with their Google account (or the
// API key or Vertex AI they set up in it), over ACP. Each answer runs in an empty workspace whose settings switch
// every built-in tool, skill, hook and extension off; Coach's rules replace Gemini's coding prompt.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CoachModel } from "@/lib/coach/loop";
import { CoachModelError } from "@/server/coach/anthropic";
import { AcpAgent, acpFailure, acpAnswer, allowCoachTools } from "./acp";
import { agentModel, type AgentAsk } from "./agent";
import { BRIDGE_NAME } from "./bridge";
import { locateProgram, programEnv, runProgram } from "./cli";
import type { AccountProvider } from "./service";
import { msg, t } from "@/lib/i18n";

const NOT_INSTALLED = msg("Install Gemini CLI first: github.com/google-gemini/gemini-cli");

/** Starts Gemini CLI, or says plainly that it can't be started. */
function startGemini(...args: Parameters<typeof AcpAgent.start>): AcpAgent {
  try {
    return AcpAgent.start(...args);
  } catch (error) {
    throw new CoachModelError("unreachable", error instanceof Error ? error.message : t("The program couldn't be started."));
  }
}

const WORKSPACE_SETTINGS = {
  tools: { core: [] as string[] },
  // A file name never present, so the athlete's own GEMINI.md files stay out of Coach.
  context: { fileName: "CLINK_COACH_CONTEXT.md" },
  skills: { enabled: false }, hooksConfig: { enabled: false }, ide: { enabled: false },
};

const geminiHome = () => path.join(process.env.GEMINI_CLI_HOME ?? os.homedir(), ".gemini");

/** The sign-in Gemini CLI will use, from its settings; Google sign-in counts once its saved credentials exist. */
export function geminiSignIn(home = geminiHome(), env: NodeJS.ProcessEnv = process.env): { method?: string; signedIn: boolean } {
  let method: string | undefined;
  try {
    const settings = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")) as { security?: { auth?: { selectedType?: unknown } }; selectedAuthType?: unknown };
    const picked = settings.security?.auth?.selectedType ?? settings.selectedAuthType;
    if (typeof picked === "string") method = picked;
  } catch { /* no settings yet */ }
  method ??= env.GEMINI_API_KEY ? "gemini-api-key" : undefined;
  if (!method) return { signedIn: false };
  if (method !== "oauth-personal") return { method, signedIn: true };
  return { method, signedIn: existsSync(path.join(home, "oauth_creds.json")) };
}

export class GeminiCliAccount implements AccountProvider {
  readonly canSignOut = false;
  readonly programName = "gemini";
  private acpFlag: string | null = null;
  /** `chosen`: the path the athlete gave under Program, if any. */
  constructor(private readonly folder: string, private readonly chosen: () => string | null = () => null) {}

  private async program(): Promise<string> {
    const found = await locateProgram("gemini", this.chosen(), programEnv());
    if (!found) throw new CoachModelError("unreachable", t(NOT_INSTALLED));
    return found;
  }

  /** `--acp` since Gemini CLI 0.3x; older ones only know `--experimental-acp`. */
  private async flag(program: string): Promise<string> {
    if (this.acpFlag) return this.acpFlag;
    const help = await runProgram(program, ["--help"], { env: programEnv() });
    this.acpFlag = /(^|\s)--acp\b/m.test(help?.stdout ?? "") ? "--acp" : "--experimental-acp";
    return this.acpFlag;
  }

  async status() {
    const program = await locateProgram("gemini", this.chosen(), programEnv());
    if (!program) return { ready: false, problem: t(NOT_INSTALLED) };
    const s = geminiSignIn();
    return s.signedIn ? { ready: true, program, account: s.method === "oauth-personal" ? t("Google account") : s.method === "gemini-api-key" ? "Gemini API key" : s.method } : { ready: false, program, problem: t("Not signed in to Gemini CLI.") };
  }

  /** Gemini CLI's own Google sign-in, in the browser. */
  async signIn(): Promise<void> {
    const program = await this.program();
    const workspace = await this.workspace();
    const agent = startGemini(program, [await this.flag(program)], { cwd: workspace, env: programEnv() });
    const timer = setTimeout(() => agent.close(), 6 * 60_000);
    try {
      await agent.initialize();
      await agent.request("authenticate", { methodId: "oauth-personal" });
    } catch (error) {
      throw acpFailure("Gemini CLI", error);
    } finally {
      clearTimeout(timer);
      agent.close();
    }
    if (!(await this.status()).ready) throw new CoachModelError("bad_key", t("Gemini CLI didn't sign in."));
  }

  async signOut(): Promise<void> {}

  async models(): Promise<string[]> {
    return ["", "pro", "flash", "flash-lite"];
  }

  private async workspace(): Promise<string> {
    const dir = path.join(this.folder, "gemini-coach", "workspace");
    await mkdir(path.join(dir, ".gemini"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, ".gemini", "settings.json"), `${JSON.stringify(WORKSPACE_SETTINGS, null, 2)}\n`, { mode: 0o600 });
    return dir;
  }

  private async answer(model: string, ask: AgentAsk) {
    const program = await this.program();
    const cwd = await this.workspace();
    const promptFile = path.join(this.folder, "gemini-coach", `${randomUUID()}.md`);
    await writeFile(promptFile, ask.system, { mode: 0o600 });
    const log: string[] = [];
    try {
      const args = [await this.flag(program), "--allowed-mcp-server-names", BRIDGE_NAME, "--extensions", "none", ...(model ? ["--model", model] : [])];
      const agent = startGemini(program, args, {
        cwd, env: programEnv({ GEMINI_SYSTEM_MD: promptFile }), onPermission: allowCoachTools,
        onStderr: (line) => { log.push(line); if (log.length > 30) log.shift(); },
      });
      // The model is chosen on the command line.
      return await acpAnswer(agent, ask, { name: "Gemini CLI", cwd, model: "", log: () => log.join("\n") });
    } finally {
      await rm(promptFile, { force: true });
    }
  }

  model(model: string): CoachModel {
    if (model && !/^[A-Za-z0-9._:-]{1,100}$/.test(model)) throw new CoachModelError("refused_request", t("That isn't a Gemini model name."));
    return agentModel((ask) => this.answer(model, ask));
  }
}
