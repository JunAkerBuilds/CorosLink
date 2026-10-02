import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { getSetting, setSetting } from "./database";
import { WatchfaceAutomationServer } from "./watchfaceAutomationServer";
import { getWorkoutEditTools, workoutEditSchemas, type WorkoutEditToolName } from "./workoutEditService";
import { workoutEdits } from "./workoutEditRuntime";
import { z } from "zod/v4";

/** Separate endpoint, token and consent from watch-face automation. No write tool is registered. */
export function registerWorkoutAutomation(getWindow: () => BrowserWindow | undefined) {
  let generation = 0;
  let active = false;
  let busy = false;
  const trusted = (event: IpcMainInvokeEvent) => {
    const window = getWindow();
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Only the CorosLink window can approve workout edits.");
  };
  const server = new WatchfaceAutomationServer({
    userDataPath: path.join(app.getPath("userData"), "workout-automation"),
    name: "coroslink-strength-workouts",
    defaultPort: 38472,
    instructions: "Read existing Strength workouts, prepare exact changes, and ask the athlete to review Settings > External AI > Workout reviews in CorosLink. There is no save tool. Only the app's review button can authorize saves. Use get_workout_edit_status to distinguish verified and uncertain outcomes. Never retry an uncertain write by drafting another edit.",
    tools: getWorkoutEditTools().map(tool => ({ name: tool.name, title: tool.name.replaceAll("_", " "), description: tool.description ?? "", method: tool.name, schema: workoutEditSchemas[tool.name as WorkoutEditToolName].shape, readOnly: ["find_editable_workouts", "read_workout_for_edit", "get_workout_edit_status"].includes(tool.name), openWorld: true })),
    dispatch: async (name, args) => {
      if (!active) throw new Error("Workout automation is disabled.");
      if (busy) throw new Error("Another workout tool is running. Retry after it completes.");
      const started = generation;
      busy = true;
      try {
        const result = await workoutEdits().tool(name as WorkoutEditToolName, args, "external");
        if (!active || generation !== started) { workoutEdits().cancelExternal(); throw new Error("Workout access was revoked."); }
        if (name.startsWith("prepare_") || name === "cancel_workout_edit") getWindow()?.webContents.send("workoutEdits:changed");
        return result;
      } finally { busy = false; }
    }
  });
  let configuration: Promise<unknown> = Promise.resolve();
  const configure = (input: unknown, persist = true) => {
    const work = configuration.catch(() => undefined).then(async () => {
      const value = z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535).optional() }).strict().parse(input);
      if (value.enabled) {
        const status = await server.start({ port: value.port });
        if (!status.enabled) throw new Error(status.error ?? "Could not start workout automation.");
        active = true;
      } else {
        active = false; generation++; workoutEdits().cancelExternal();
        await server.stop({ revokeToken: true });
      }
      if (persist) setSetting("workouts.externalAi", JSON.stringify({ enabled: value.enabled, port: server.getStatus().port ?? value.port }));
      return server.getStatus();
    });
    configuration = work;
    return work;
  };
  ipcMain.handle("workoutAutomation:status", event => { trusted(event); return server.getStatus(); });
  ipcMain.handle("workoutAutomation:configure", (event, value) => { trusted(event); return configure(value); });
  ipcMain.handle("workoutEdits:list", event => { trusted(event); return workoutEdits().list(); });
  ipcMain.handle("workoutEdits:status", (event, proposalId) => { trusted(event); return workoutEdits().status(z.string().uuid().parse(proposalId)); });
  ipcMain.handle("workoutEdits:cancel", (event, proposalId) => {
    trusted(event);
    const service = workoutEdits();
    const proposal = service.list().find(p => p.proposalId === proposalId);
    if (!proposal) throw new Error("Proposal not found.");
    return service.tool("cancel_workout_edit", { proposalId }, proposal.origin);
  });
  ipcMain.handle("workoutEdits:confirm", async (event, input) => {
    trusted(event);
    const value = z.object({ proposalId: z.string().uuid(), reviewHash: z.string().length(64), selectedIds: z.array(z.string().uuid()).min(1).max(25) }).strict().parse(input);
    const proposal = workoutEdits().list().find(p => p.proposalId === value.proposalId);
    if (proposal?.origin === "external" && !active) throw new Error("Workout automation was disabled. Prepare a new review.");
    const result = await workoutEdits().confirm(value.proposalId, value.reviewHash, value.selectedIds);
    getWindow()?.webContents.send("workoutEdits:changed");
    return result;
  });
  return {
    restore: async () => { const saved = getSetting("workouts.externalAi"); if (saved) { try { const value = JSON.parse(saved); if (value.enabled) await configure(value, false); } catch { /* status exposes server startup errors; settings can retry */ } } },
    stop: async () => { active = false; generation++; await configuration.catch(() => undefined); await server.stop(); }
  };
}
