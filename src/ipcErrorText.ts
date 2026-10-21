/** An IPC call's error message, without the "Error invoking remote method '…': Error: " prefix ipcRenderer adds. */
export function ipcErrorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
