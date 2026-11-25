import { describe, expect, it } from "vitest";
import { addressFor } from "./media";

describe("the YouTube box", () => {
  it("opens a link as it is and searches YouTube for words", () => {
    expect(addressFor(" https://youtu.be/dQw4w9WgXcQ ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(addressFor("youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://youtube.com/watch?v=dQw4w9WgXcQ");
    expect(addressFor("daft punk & friends")).toBe("https://www.youtube.com/results?search_query=daft%20punk%20%26%20friends");
  });
});
