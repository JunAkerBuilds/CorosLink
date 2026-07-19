const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const repoRoot = path.resolve(__dirname, "..");
const port = 5189;
const origin = `http://127.0.0.1:${port}`;

async function waitForVite(child) {
  let earlyExit = null;
  child.once("exit", (code) => {
    earlyExit = code;
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (earlyExit !== null) {
      throw new Error(`Vite exited before the stroke test loaded (code ${earlyExit}).`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the Vite stroke-test server.");
}

async function main() {
  const vite = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev:renderer", "--", "--port", String(port), "--strictPort"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  let viteError = "";
  vite.stderr.on("data", (chunk) => {
    viteError += chunk.toString();
  });

  try {
    await waitForVite(vite);
    await app.whenReady();
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true
      }
    });
    await window.loadURL(origin);
    const results = await window.webContents.executeJavaScript(`
      (async () => {
        const {
          renderWatchfaceCanvasDecorationsWithOpacity,
          renderWatchfaceCanvasStrokes
        } = await import("/src/watchfaces/watchfaceEditorStrokes.ts");
        const {
          applyWatchfaceDataUrlOpacity,
          loadStudioImage,
          renderNativeRasterImageSprite
        } = await import("/src/watchfaces/watchfaceStudio.ts");

        const makeSource = () => {
          const canvas = document.createElement("canvas");
          canvas.width = 20;
          canvas.height = 20;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.fillStyle = "#00ff00";
          context.fillRect(6, 6, 8, 8);
          return canvas;
        };
        const stroke = (patch = {}) => ({
          id: patch.id ?? "stroke",
          enabled: patch.enabled ?? true,
          paint: patch.paint ?? { kind: "solid", color: "#ff0000" },
          opacity: patch.opacity ?? 1,
          position: patch.position ?? "outside",
          weight: patch.weight ?? 4
        });
        const pixel = (canvas, x, y) => {
          const data = canvas
            .getContext("2d", { willReadFrequently: true })
            .getImageData(x, y, 1, 1).data;
          return [...data];
        };

        const outside = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke()],
          1,
          true
        );
        const center = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke({ position: "center" })],
          1,
          true
        );
        const inside = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke({ position: "inside", weight: 2 })],
          1,
          true
        );
        const stacked = renderWatchfaceCanvasStrokes(
          makeSource(),
          [
            stroke({ id: "front", paint: { kind: "solid", color: "#ff0000" } }),
            stroke({ id: "back", paint: { kind: "solid", color: "#0000ff" } })
          ],
          1,
          true
        );
        const gradient = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke({
            paint: {
              kind: "linear-gradient",
              from: "#ff0000",
              to: "#0000ff",
              angle: 0
            }
          })],
          1,
          true
        );
        const translucent = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke({ opacity: 0.5 })],
          1,
          true
        );
        const disabled = renderWatchfaceCanvasStrokes(
          makeSource(),
          [stroke({ enabled: false })],
          1,
          true
        );
        const fadedWithStroke = renderWatchfaceCanvasDecorationsWithOpacity(
          makeSource(),
          [stroke()],
          [],
          0.2,
          1,
          true
        );
        const opacitySource = document.createElement("canvas");
        opacitySource.width = 2;
        opacitySource.height = 2;
        const opacitySourceContext = opacitySource.getContext("2d");
        opacitySourceContext.fillStyle = "#ff0000";
        opacitySourceContext.fillRect(0, 0, 2, 2);
        const opacityImage = await loadStudioImage(
          await applyWatchfaceDataUrlOpacity(
            opacitySource.toDataURL("image/png"),
            0.35
          ),
          false
        );
        const opacityResult = document.createElement("canvas");
        opacityResult.width = 2;
        opacityResult.height = 2;
        opacityResult.getContext("2d").drawImage(opacityImage, 0, 0);

        const weekdaySource = document.createElement("canvas");
        weekdaySource.width = 30;
        weekdaySource.height = 10;
        const weekdayContext = weekdaySource.getContext("2d");
        weekdayContext.fillStyle = "#ffffff";
        weekdayContext.fillRect(2, 1, 4, 8);
        weekdayContext.fillRect(12, 1, 4, 8);
        weekdayContext.fillRect(22, 1, 4, 8);
        const weekdayDataUrl = weekdaySource.toDataURL("image/png");
        const weekdayDefault = await loadStudioImage(
          await renderNativeRasterImageSprite(
            weekdayDataUrl,
            20,
            undefined,
            false,
            0,
            3
          ),
          false
        );
        const weekdaySpaced = await loadStudioImage(
          await renderNativeRasterImageSprite(
            weekdayDataUrl,
            20,
            undefined,
            false,
            0.2,
            3
          ),
          false
        );

        return {
          outside: {
            padding: outside.padding,
            size: [outside.canvas.width, outside.canvas.height],
            ring: pixel(outside.canvas, 7, 14),
            source: pixel(outside.canvas, 12, 12)
          },
          center: {
            padding: center.padding,
            ring: pixel(center.canvas, 6, 12)
          },
          inside: {
            padding: inside.padding,
            outside: pixel(inside.canvas, 4, 10),
            edge: pixel(inside.canvas, 6, 10),
            center: pixel(inside.canvas, 10, 10)
          },
          stacked: pixel(stacked.canvas, 7, 14),
          gradient: {
            left: pixel(gradient.canvas, 7, 14),
            right: pixel(gradient.canvas, 20, 14)
          },
          translucent: pixel(translucent.canvas, 7, 14),
          disabled: {
            padding: disabled.padding,
            size: [disabled.canvas.width, disabled.canvas.height]
          },
          fadedWithStroke: {
            stroke: pixel(fadedWithStroke.canvas, 7, 14),
            source: pixel(fadedWithStroke.canvas, 12, 12)
          },
          layerOpacity: pixel(opacityResult, 0, 0),
          spriteSpacing: {
            defaultWidth: weekdayDefault.naturalWidth,
            spacedWidth: weekdaySpaced.naturalWidth
          }
        };
      })()
    `);

    assert.deepEqual(results.outside.padding, {
      left: 4,
      top: 4,
      right: 4,
      bottom: 4
    });
    assert.deepEqual(results.outside.size, [28, 28]);
    assert.ok(results.outside.ring[0] > 180 && results.outside.ring[3] > 0);
    assert.ok(results.outside.source[1] > 180, "source pixels remain above the outside stroke");
    assert.deepEqual(results.center.padding, {
      left: 2,
      top: 2,
      right: 2,
      bottom: 2
    });
    assert.ok(results.center.ring[3] > 0);
    assert.deepEqual(results.inside.padding, {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    });
    assert.equal(results.inside.outside[3], 0);
    assert.ok(results.inside.edge[0] > 180);
    assert.ok(results.inside.center[1] > 180);
    assert.ok(results.stacked[0] > results.stacked[2], "front stroke wins overlap");
    assert.ok(results.gradient.left[0] > results.gradient.left[2]);
    assert.ok(results.gradient.right[2] > results.gradient.right[0]);
    assert.ok(
      results.translucent[3] > 80 && results.translucent[3] < 200,
      "stroke opacity changes output alpha"
    );
    assert.deepEqual(results.disabled.padding, {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0
    });
    assert.deepEqual(results.disabled.size, [20, 20]);
    assert.ok(
      results.fadedWithStroke.stroke[3] > 200,
      "sprite opacity does not fade the independent stroke"
    );
    assert.ok(
      results.fadedWithStroke.source[3] >= 50 &&
        results.fadedWithStroke.source[3] <= 52,
      "sprite source opacity remains independently adjustable"
    );
    assert.ok(
      results.layerOpacity[3] >= 88 && results.layerOpacity[3] <= 90,
      "layer opacity multiplies exported PNG alpha"
    );
    assert.ok(
      results.spriteSpacing.spacedWidth > results.spriteSpacing.defaultWidth,
      "weekday sprite spacing separates glyphs in an imported bitmap"
    );
    window.destroy();
    console.log("watchface stroke renderer tests passed");
  } finally {
    vite.kill("SIGTERM");
    if (!vite.killed && viteError) process.stderr.write(viteError);
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
