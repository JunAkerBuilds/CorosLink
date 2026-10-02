import assert from "node:assert/strict";
import { isWebUrl } from "../dist-electron/externalLinks.js";

for (const url of ["https://example.com", "http://localhost:5173/x", "HTTPS://Example.com/a?b=c"]) {
  assert.equal(isWebUrl(url), true, url);
}
for (const url of [
  "file:///etc/passwd",
  "smb://attacker/share",
  "javascript:alert(1)",
  "coroslink://import?x=1",
  "vscode://file/x",
  "mailto:a@b.c",
  "not a url",
  ""
]) {
  assert.equal(isWebUrl(url), false, url);
}
console.log("external links: ok");
