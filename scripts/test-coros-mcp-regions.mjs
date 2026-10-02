import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(path.join(repoRoot, "electron", "corosMcpRegions.ts"));
const {
  corosMcpRegion,
  corosMcpUrl,
  corosSignInEmailScript,
  isCorosMcpUrl,
  isCorosSignInPage
} = await import(`${modUrl.href}?c=${Date.now()}`);

// Every regional endpoint COROS publishes, plus the US alias.
assert.equal(corosMcpRegion("https://mcpus.coros.com/mcp"), "us");
assert.equal(corosMcpRegion("https://mcpeu.coros.com/mcp"), "eu");
assert.equal(corosMcpRegion("https://mcpcn.coros.com/mcp"), "cn");
assert.equal(corosMcpRegion("https://mcp.coros.com/mcp"), "us");
assert.equal(corosMcpRegion("https://MCPEU.COROS.COM/mcp"), "eu");
for (const region of ["us", "eu", "cn"]) {
  assert.equal(corosMcpRegion(corosMcpUrl(region)), region);
}

// Other servers, plain HTTP, and lookalike hosts are not COROS.
for (const url of [
  "http://mcpeu.coros.com/mcp",
  "https://mcp.strava.com/mcp",
  "https://mcpeu.coros.com.evil.example/mcp",
  "https://evilmcpus.coros.com/mcp",
  "https://mcpsg.coros.com/mcp",
  "not a url"
]) {
  assert.equal(corosMcpRegion(url), null, url);
  assert.equal(isCorosMcpUrl(url), false, url);
}

// Sign-in hints go only to COROS's own OAuth form.
assert.equal(
  isCorosSignInPage("https://openeu.coros.com/oauth2/authorize?client_id=x&state=y"),
  true
);
assert.equal(isCorosSignInPage("https://openus.coros.com/oauth2/authorize"), true);
assert.equal(isCorosSignInPage("https://opencn.coros.com/oauth2/authorize"), true);
for (const url of [
  "http://openus.coros.com/oauth2/authorize",
  "https://openus.coros.com/oauth2/token",
  "https://mcpus.coros.com/oauth2/authorize",
  "https://openus.coros.com.evil.example/oauth2/authorize",
  "http://localhost:1456/coros-mcp/callback?code=x"
]) {
  assert.equal(isCorosSignInPage(url), false, url);
}

// The injected script against a stand-in for COROS's form.
function runSignIn(script, existingEmail = "") {
  class HTMLInputElement {
    events = [];
    focused = false;
    constructor(value) {
      this.value = value;
    }
    dispatchEvent(event) {
      this.events.push(`${event.type}${event.bubbles ? ":bubbles" : ""}`);
      return true;
    }
    focus() {
      this.focused = true;
    }
  }
  const fields = {
    txt_userName: new HTMLInputElement(existingEmail),
    psw_password: new HTMLInputElement("")
  };
  vm.runInNewContext(script, {
    document: { getElementById: (id) => fields[id] ?? null },
    HTMLInputElement,
    Event
  });
  return fields;
}

const filled = runSignIn(corosSignInEmailScript("runner@example.com"));
assert.equal(filled.txt_userName.value, "runner@example.com");
assert.deepEqual(filled.txt_userName.events, ["input:bubbles"]);
assert.equal(filled.psw_password.focused, true);

const typed = runSignIn(corosSignInEmailScript("runner@example.com"), "other@example.com");
assert.equal(typed.txt_userName.value, "other@example.com", "A typed email wins");
assert.deepEqual(typed.txt_userName.events, []);
assert.equal(typed.psw_password.focused, false);

const hostile = `a"b\\c</script> @example.com`;
assert.equal(runSignIn(corosSignInEmailScript(hostile)).txt_userName.value, hostile);

// A changed page without the field is left alone.
vm.runInNewContext(corosSignInEmailScript("runner@example.com"), {
  document: { getElementById: () => null },
  HTMLInputElement: class {},
  Event
});

console.log("coros-mcp-regions tests passed");
