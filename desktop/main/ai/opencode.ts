// OpenCode: Coach answered through the athlete's installed `opencode`, with whatever providers they signed in to
// there (`opencode auth login`), over ACP. Each answer gets its own configuration: one Coach agent with Coach's rules,
// every permission denied but Coach's tools, and the bridge declared so its tools are plain tools.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CoachModel } from "@/lib/coach/loop";
import { CoachModelError } from "@/server/coach/anthropic";
import { AcpAgent, acpAnswer, acpFailure, sessionModels } from "./acp";
import { agentModel, type AgentAsk } from "./agent";
import { BRIDGE_NAME } from "./bridge";
import { locateProgram, programEnv, runProgram } from "./cli";
import type { AccountProvider } from "./service";
import { msg, t } from "@/lib/i18n";

const NOT_INSTALLED = msg("Install OpenCode first: opencode.ai");
const COACH_AGENT = "clink-coach";
const MCP_TIMEOUT_MS = 5 * 60_000;

/** OpenCode replaces `{env:…}` and `{file:…}` anywhere in its configuration; the athlete's own text mustn't. */
const withoutVariables = (text: string) => text.replace(/\{(env|file):/gi, "{ $1:");

/** The configuration for one answer, in OpenCode 1.x's shape or 2.x's. */
export function opencodeConfig(major: number, system: string, bridge: { url: string; token: string } | null): Record<string, unknown> {
  const prompt = withoutVariables(system);
  const server = bridge && { type: "remote", url: bridge.url, headers: { Authorization: `Bearer ${bridge.token}` }, oauth: false };
  if (major < 2) {
    const permission = { "*": "deny", [`${BRIDGE_NAME}_*`]: "allow" };
    return {
      $schema: "https://opencode.ai/config.json", default_agent: COACH_AGENT, share: "disabled", snapshot: false, permission,
      ...(server ? { mcp: { [BRIDGE_NAME]: { ...server, timeout: MCP_TIMEOUT_MS } } } : {}),
      agent: { [COACH_AGENT]: { mode: "primary", description: "C-LINK Coach", prompt, permission } },
    };
  }
  const permissions = [{ action: "*", resource: "*", effect: "deny" }, { action: `${BRIDGE_NAME}_*`, resource: "*", effect: "allow" }];
  return {
    $schema: "https://opencode.ai/config.json", default_agent: COACH_AGENT, snapshots: false, permissions,
    // 2.x reaches a server's tools through Code Mode unless it says not to, and one passed over ACP can't say it:
    // the bridge is declared here only.
    ...(server ? { mcp: { servers: { [BRIDGE_NAME]: { ...server, codemode: false, timeout: { execution: MCP_TIMEOUT_MS } } } } } : {}),
    agents: { [COACH_AGENT]: { mode: "primary", description: "C-LINK Coach", system: prompt, permissions } },
  };
}

export class OpenCodeAccount implements AccountProvider {
  readonly canSignOut = false;
  readonly programName = "opencode";
  private major: number | null = null;
  private listed: { at: number; models: string[] } | null = null;
  /** `chosen`: the path the athlete gave under Program, if any. */
  constructor(private readonly folder: string, private readonly chosen: () => string | null = () => null) {}

  private async program(): Promise<string> {
    const found = await locateProgram("opencode", this.chosen(), programEnv());
    if (!found) throw new CoachModelError("unreachable", t(NOT_INSTALLED));
    return found;
  }

  private async version(program: string): Promise<number> {
    if (this.major !== null) return this.major;
    const out = await runProgram(program, ["--version"], { env: programEnv() });
    this.major = Number(/(\d+)\.\d+/.exec(out?.stdout ?? "")?.[1] ?? 2);
    return this.major;
  }

  async status() {
    const program = await locateProgram("opencode", this.chosen(), programEnv());
    if (!program) return { ready: false, problem: t(NOT_INSTALLED) };
    const out = await runProgram(program, ["auth", "list"], { env: programEnv() });
    const signedIn = /stored|oauth|api key/i.test(`${out?.stdout ?? ""}${out?.stderr ?? ""}`);
    return signedIn ? { ready: true, program } : { ready: false, program, problem: t("Run `opencode auth login` in a terminal first.") };
  }

  /** OpenCode signs in in a terminal: there is nothing for C-LINK to open. */
  async signIn(): Promise<void> {
    if (!(await this.status()).ready) throw new CoachModelError("bad_key", t("Run `opencode auth login` in a terminal, then try again."));
  }

  async signOut(): Promise<void> {}

  /** Starts OpenCode with an answer's configuration; `stop` removes the configuration again. */
  private async launch(system: string, bridge: { url: string; token: string } | null): Promise<{ agent: AcpAgent; cwd: string; stop: () => Promise<void>; log: string[] }> {
    const program = await this.program();
    const dir = path.join(this.folder, "opencode-coach");
    const cwd = path.join(dir, "workspace");
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    const config = path.join(dir, `${randomUUID()}.json`);
    await writeFile(config, JSON.stringify(opencodeConfig(await this.version(program), system, bridge)), { mode: 0o600 });
    const log: string[] = [];
    let agent: AcpAgent;
    try {
      agent = AcpAgent.start(program, ["acp"], {
        cwd, env: programEnv({ OPENCODE_CONFIG: config, OPENCODE_CONFIG_CONTENT: undefined }),
        onStderr: (line) => { log.push(line); if (log.length > 30) log.shift(); },
      });
    } catch (error) {
      await rm(config, { force: true });
      throw new CoachModelError("unreachable", error instanceof Error ? error.message : t("OpenCode couldn't be started."));
    }
    return { agent, cwd, log, stop: async () => { agent.close(); await rm(config, { force: true }); } };
  }

  /**
   * Puts the session on C-LINK's Coach agent; a session on any other agent would have OpenCode's own tools. 2.x starts
   * the session before it has read the answer's configuration, and says it has with a later update.
   */
  private static async onCoachAgent(agent: AcpAgent, session: Record<string, unknown>, sessionId: string): Promise<void> {
    const mode = (o: unknown) => ((o as { configOptions?: { id?: string; currentValue?: unknown }[] })?.configOptions ?? []).find((c) => c.id === "mode")?.currentValue;
    if (mode(session) !== COACH_AGENT) {
      const earlier = agent.onUpdate;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        agent.onUpdate = (u) => { earlier(u); if (u.sessionUpdate === "config_option_update" && JSON.stringify(u).includes(COACH_AGENT)) { clearTimeout(timer); resolve(); } };
      }).finally(() => { agent.onUpdate = earlier; });
    }
    await agent.request("session/set_config_option", { sessionId, configId: "mode", value: COACH_AGENT })
      .catch(() => agent.request("session/set_mode", { sessionId, modeId: COACH_AGENT }))
      .catch(() => { throw new CoachModelError("refused_request", t("This OpenCode didn't load C-LINK's Coach setup. Update OpenCode and try again.")); });
  }

  async models(): Promise<string[]> {
    if (this.listed && Date.now() - this.listed.at < 10 * 60_000) return this.listed.models;
    const { agent, cwd, stop } = await this.launch("", null);
    const timer = setTimeout(() => agent.close(), 60_000);
    try {
      let latest: unknown = null;
      agent.onUpdate = (u) => { if (u.sessionUpdate === "config_option_update") latest = u; };
      await agent.initialize();
      const session = await agent.request("session/new", { cwd, mcpServers: [] });
      // 2.x follows its answer with the models its configuration gives.
      await new Promise((r) => setTimeout(r, 800));
      const found = sessionModels(latest ?? session);
      const models = ["", ...found.models.map((m) => m.value)];
      this.listed = { at: Date.now(), models };
      return models;
    } catch (error) {
      throw acpFailure("OpenCode", error);
    } finally {
      clearTimeout(timer);
      await stop();
    }
  }

  private async answer(model: string, ask: AgentAsk) {
    const { agent, cwd, stop, log } = await this.launch(ask.system, ask.bridge);
    try {
      return await acpAnswer(agent, ask, { name: "OpenCode", cwd, model, bridgeInSession: false, log: () => log.join("\n"), started: (session, id) => OpenCodeAccount.onCoachAgent(agent, session, id) });
    } finally {
      await stop();
    }
  }

  model(model: string): CoachModel {
    return agentModel((ask) => this.answer(model, ask));
  }
}
