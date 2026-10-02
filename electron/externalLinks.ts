/**
 * Only http(s) links may be handed to the OS. Anything else (file:, smb:,
 * custom app schemes, javascript:) could launch local files or apps when a
 * crafted link shows up in chat or MCP-supplied content.
 */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
