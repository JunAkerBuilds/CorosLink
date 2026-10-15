import { t, useLanguage } from "../i18n/tools";
import type { CorosMcpTool } from "../../electron/types";

export function CorosMcpToolsPanel({
  tools,
  onDisconnect,
  className
}: {
  tools: CorosMcpTool[];
  onDisconnect?: () => void;
  className?: string;
}) {
  useLanguage();
  return (
    <div className={["chat-mcp-panel", className].filter(Boolean).join(" ")}>
      <div className="chat-mcp-panel-head">
        <span>{tools.length}  {t("COROS tools")}</span>
        {onDisconnect ? (
          <button type="button" onClick={onDisconnect}>
            {t("Disconnect")}</button>
        ) : null}
      </div>
      <ul>
        {tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>
            {tool.description ? <span>{tool.description}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
