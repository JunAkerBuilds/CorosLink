import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Art, artAllowed, artPath } from "./art";
import { pickImage } from "./spotify";

describe("cover art", () => {
  it("fetches only from the services' image hosts, over https", () => {
    for (const ok of ["https://i.scdn.co/image/ab67", "https://mosaic.scdn.co/640/x", "https://is1-ssl.mzstatic.com/a.jpg", "https://i.ytimg.com/vi/x/hq.jpg", "https://lh3.googleusercontent.com/x"]) expect(artAllowed(ok)).toBe(true);
    for (const bad of ["http://i.scdn.co/image/ab67", "https://evil.example/a.jpg", "https://i.scdn.co.evil.example/a", "https://user@i.scdn.co/a", "https://i.scdn.co:8443/a", "file:///etc/passwd"]) expect(artAllowed(bad)).toBe(false);
    expect(artPath("https://evil.example/a.jpg")).toBeNull();
    expect(artPath("https://i.scdn.co/image/ab")).toBe("/api/desktop/media/art?u=https%3A%2F%2Fi.scdn.co%2Fimage%2Fab");
  });

  it("downloads a cover once, and refuses anything that isn't an image", async () => {
    let calls = 0;
    const get = (async (url: string) => { calls++; return url.endsWith("/html") ? new Response("<html>", { headers: { "content-type": "text/html" } }) : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }); }) as typeof fetch;
    const art = new Art(mkdtempSync(path.join(tmpdir(), "clink-art-")), get);
    const first = await art.answer("https://i.scdn.co/image/a");
    expect(first.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await first.arrayBuffer())]).toEqual([1, 2, 3]);
    expect([...new Uint8Array(await (await art.answer("https://i.scdn.co/image/a")).arrayBuffer())]).toEqual([1, 2, 3]);
    expect(calls).toBe(1);
    expect((await art.answer("https://i.scdn.co/image/html")).status).toBe(404);
    expect((await art.answer("https://evil.example/a.jpg")).status).toBe(404);
  });

  it("picks a cover big enough for where it shows", () => {
    const images = [{ url: "640", width: 640 }, { url: "300", width: 300 }, { url: "64", width: 64 }];
    expect(pickImage(images, 64)).toBe("64");
    expect(pickImage(images, 300)).toBe("300");
    expect(pickImage([{ url: "mosaic", width: null }], 300)).toBe("mosaic");
    expect(pickImage(null, 64)).toBeNull();
  });
});
