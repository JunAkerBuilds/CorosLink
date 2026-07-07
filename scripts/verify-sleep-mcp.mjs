// Probe live COROS MCP querySleepData response shape using stored app tokens.
// Usage: npm run build:electron && npx electron scripts/verify-sleep-mcp.mjs

import { app } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

app.whenReady().then(async () => {
  const { initializeDatabase } = await import(`${distUrl("database.js")}`);
  const { connectCorosMcp, getCorosMcpTools, callCorosMcpTool } = await import(
    `${distUrl("corosMcpService.js")}`
  );
  const { getTrainingSleepData, parseSleepDataResponse } = await import(
    `${distUrl("sleepDataService.js")}`
  );

  initializeDatabase(app.getPath("userData"));

  try {
    await connectCorosMcp(null, false);
  } catch (error) {
    console.error("MCP connect failed:", error);
    app.exit(1);
    return;
  }

  const tools = getCorosMcpTools();
  const sleepTool = tools.find((tool) => tool.name === "querySleepData");
  console.log(
    "querySleepData schema:",
    JSON.stringify(sleepTool?.inputSchema ?? null, null, 2)
  );

  if (sleepTool) {
    const argVariants = [
      {},
      { startDate: "2026-07-01", endDate: "2026-07-07" },
      { startDate: "20260701", endDate: "20260707" },
      { startDay: "20260701", endDay: "20260707" },
      { weeks: 1 }
    ];

    for (const args of argVariants) {
      try {
        const response = await callCorosMcpTool("querySleepData", args);
        const parsed = parseSleepDataResponse(response);
        console.log("\n--- args:", JSON.stringify(args));
        console.log("parsed count:", parsed.length);
        console.log("response preview:", response.slice(0, 1200));
        if (parsed.length > 0) {
          console.log("first record:", JSON.stringify(parsed[0], null, 2));
        }
      } catch (error) {
        console.log("\n--- args:", JSON.stringify(args), "FAILED:", error);
      }
    }
  }

  const summary = await getTrainingSleepData(null, 7);
  console.log("\ngetTrainingSleepData summary:", JSON.stringify(summary, null, 2));

  app.exit(0);
});
