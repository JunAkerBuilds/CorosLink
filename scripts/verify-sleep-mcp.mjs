// Probe the live COROS MCP sleep tool (querySleepOverview, or whatever resolveSleepTool picks)
// using stored app tokens. Prints the schema, the planned args, every call the app makes, and
// the parsed summary.
// Usage: npm run build:electron && npx electron scripts/verify-sleep-mcp.mjs
// Override COROSLINK_USER_DATA only when testing another saved CorosLink profile.

import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

// safeStorage only decrypts the saved tokens under the app's own name.
app.setName("coroslink");
app.setPath(
  "userData",
  process.env.COROSLINK_USER_DATA || path.join(app.getPath("appData"), "coroslink")
);

app.whenReady().then(async () => {
  app.dock?.hide();
  const { initializeDatabase } = await import(`${distUrl("database.js")}`);
  const { connectCorosMcp, getCorosMcpTools, callCorosMcpTool } = await import(
    `${distUrl("corosMcpService.js")}`
  );
  const {
    buildSleepToolArgs,
    getTrainingSleepData,
    resolveSleepTool,
    setSleepToolCallerForTests
  } = await import(`${distUrl("sleepDataService.js")}`);

  initializeDatabase(app.getPath("userData"));

  try {
    await connectCorosMcp(null, false);
  } catch (error) {
    console.error("MCP connect failed:", error);
    app.exit(1);
    return;
  }

  const days = 7;
  const sleepTool = resolveSleepTool(getCorosMcpTools());
  if (!sleepTool) {
    console.error("No sleep tool in the COROS MCP tool list.");
    app.exit(1);
    return;
  }

  console.log(`${sleepTool.name} schema:`, JSON.stringify(sleepTool.inputSchema, null, 2));
  console.log("planned args:", JSON.stringify(buildSleepToolArgs(sleepTool, days), null, 2));

  // Log the calls the app actually sends instead of probing extra variants.
  let callCount = 0;
  setSleepToolCallerForTests(async (name, args) => {
    callCount += 1;
    const response = await callCorosMcpTool(name, args);
    console.log(`\n--- call ${callCount}: ${name} ${JSON.stringify(args)}`);
    console.log("response preview:", response.slice(0, 600));
    return response;
  });

  const summary = await getTrainingSleepData(null, days);
  console.log(`\n${callCount} call(s); ${summary.records.length} record(s):`,
    summary.records.map((record) => record.happenDay).join(", "));
  console.log("latest:", JSON.stringify(summary.latest ?? null, null, 2));

  app.exit(0);
});
