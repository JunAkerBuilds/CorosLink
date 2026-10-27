import type { QRCodeToDataURLOptions } from "qrcode";

/** Draws a QR code as a PNG data URL. The library loads on first use to keep it out of app startup. */
export function qrCodeDataUrl(text: string, options: QRCodeToDataURLOptions): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("qrcode") as typeof import("qrcode")).toDataURL(text, options);
}
