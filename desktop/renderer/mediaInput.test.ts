// Media's drags, clicks and tabs: dropped folders, selection ranges, and CorosLink's rule that Library never hides.
import { describe, expect, it } from "vitest";
import { canHideTab, carriesFiles, clickSelect, splitMp3s, stepSelect, visibleTabs, walkEntries, type EntryLike } from "./mediaInput";

const file = (fullPath: string): EntryLike => {
  const name = fullPath.split("/").pop()!;
  return { isFile: true, isDirectory: false, name, fullPath, file: (ok) => ok(new File(["x"], name)) };
};
/** A folder whose reader hands its children over two at a time, as Chromium does in batches. */
const folder = (fullPath: string, children: EntryLike[]): EntryLike => ({
  isFile: false, isDirectory: true, name: fullPath.split("/").pop()!, fullPath,
  createReader: () => { let at = 0; return { readEntries: (ok) => { const batch = children.slice(at, at + 2); at += 2; ok(batch); } }; },
});

describe("dropping files and folders", () => {
  it("opens folders all the way down, in the folder's own order, leaving out hidden files", async () => {
    const dropped = [
      folder("/Run mix", [file("/Run mix/10 Cooldown.mp3"), file("/Run mix/2 Warm up.mp3"), file("/Run mix/.DS_Store"), file("/Run mix/._2 Warm up.mp3"),
        folder("/Run mix/Bonus", [file("/Run mix/Bonus/1 Extra.mp3")]), file("/Run mix/3 Tempo.MP3"), file("/Run mix/cover.jpg")]),
      file("/Single.mp3"),
    ];
    const names = (await walkEntries(dropped)).map((f) => f.name);
    expect(names).toEqual(["2 Warm up.mp3", "3 Tempo.MP3", "10 Cooldown.mp3", "1 Extra.mp3", "cover.jpg", "Single.mp3"]);
  });

  it("lets only MP3s in (any letter case) and counts the rest", () => {
    const { mp3s, skipped } = splitMp3s([new File([""], "a.mp3"), new File([""], "B.MP3"), new File([""], "c.flac"), new File([""], "d.m4a")]);
    expect(mp3s.map((f) => f.name)).toEqual(["a.mp3", "B.MP3"]);
    expect(skipped).toBe(2);
  });

  it("tells a drag of files from Finder from anything else", () => {
    expect(carriesFiles(["Files"])).toBe(true);
    expect(carriesFiles(["text/plain", "application/x-clink-tracks"])).toBe(false);
    expect(carriesFiles(undefined)).toBe(false);
  });
});

describe("selecting rows", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("picks one on a click, toggles with ⌘, and takes the range from the last click with Shift", () => {
    let s = clickSelect(order, new Set(), null, "b", {});
    expect([...s.picked]).toEqual(["b"]);
    s = clickSelect(order, s.picked, s.anchor, "d", { shift: true });
    expect([...s.picked]).toEqual(["b", "c", "d"]);
    s = clickSelect(order, s.picked, s.anchor, "c", { toggle: true });
    expect([...s.picked].sort()).toEqual(["b", "d"]);
    s = clickSelect(order, new Set(["e"]), "e", "c", { shift: true });
    expect([...s.picked]).toEqual(["c", "d", "e"]);
  });

  it("moves with the arrow keys and extends with Shift, stopping at the ends", () => {
    let s = stepSelect(order, new Set(), null, null, 1, false)!;
    expect([...s.picked]).toEqual(["a"]);
    s = stepSelect(order, s.picked, s.anchor, s.focus, 1, true)!;
    s = stepSelect(order, s.picked, s.anchor, s.focus, 1, true)!;
    expect([...s.picked]).toEqual(["a", "b", "c"]);
    s = stepSelect(order, s.picked, s.anchor, "a", -1, false)!;
    expect([...s.picked]).toEqual(["a"]);
    expect(stepSelect([], new Set(), null, null, 1, false)).toBeNull();
  });
});

describe("service tabs", () => {
  const tabs = [{ id: "library" }, { id: "youtube" }, { id: "spotify" }];

  it("never hides Library, the place every download lands", () => {
    expect(canHideTab("library")).toBe(false);
    expect(visibleTabs(tabs, ["library", "spotify"], "youtube").map((t) => t.id)).toEqual(["library", "youtube"]);
  });

  it("still shows a hidden tab while it's open", () => {
    expect(visibleTabs(tabs, ["spotify"], "spotify").map((t) => t.id)).toEqual(["library", "youtube", "spotify"]);
  });
});
