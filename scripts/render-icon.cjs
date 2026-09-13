const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

// Use Chromium's canvas export instead of a screenshot to preserve alpha and
// produce an exact 1024px image regardless of the display's pixel density.
app.disableHardwareAcceleration();

async function render() {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error("Usage: electron scripts/render-icon.cjs <source.svg|png> <output.png>");
  }
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension !== ".svg" && extension !== ".png") {
    throw new Error("Icon sources must be SVG or PNG.");
  }
  const mime = extension === ".svg" ? "image/svg+xml" : "image/png";
  const dataUrl = `data:${mime};base64,${fs.readFileSync(sourcePath).toString("base64")}`;

  await app.whenReady();
  app.dock?.hide();
  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadURL("about:blank");
  const png = await window.webContents.executeJavaScript(`
    (async () => {
      const image = new Image();
      image.src = ${JSON.stringify(dataUrl)};
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create a 2D rendering context.");
      context.drawImage(image, 0, 0, 1024, 1024);
      return canvas.toDataURL("image/png").split(",")[1];
    })()
  `);
  fs.writeFileSync(outputPath, Buffer.from(png, "base64"));
  window.destroy();
}

render().then(
  () => app.quit(),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
