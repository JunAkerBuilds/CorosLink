import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { decodeToolboxMenu, neteaseToolboxState, neteaseThirdPartySwitch, TOOLBOX_NETEASE } = require("../dist-electron/corosWatchToolbox.js");

// Read from a PACE Pro on 3.2008.0 before and after writing 0x27 = 0x3E.
const before = Buffer.from("08011a1c0a170d012c122d221e0504000908100a0b2402030f13061617120125", "hex");
const after = Buffer.from("08011a1d0a180d012c122d221e0504000908100a0b2402030f1306161726120125", "hex");
const shown = [0x0d, 0x01, 0x2c, 0x12, 0x2d, 0x22, 0x1e, 0x05, 0x04, 0x00, 0x09, 0x08, 0x10, 0x0a, 0x0b, 0x24, 0x02, 0x03, 0x0f, 0x13, 0x06, 0x16, 0x17];
assert.deepEqual(decodeToolboxMenu(before), { shown, hidden: [0x25] });
assert.deepEqual(decodeToolboxMenu(after), { shown: [...shown, TOOLBOX_NETEASE], hidden: [0x25] });
assert.equal(neteaseToolboxState(decodeToolboxMenu(before)), "missing");
assert.equal(neteaseToolboxState(decodeToolboxMenu(after)), "shown");
assert.equal(neteaseToolboxState({ shown: [], hidden: [TOOLBOX_NETEASE] }), "hidden");

// Alipay and Xiaoyuzhou keep what the list shows; NetEase and bits 3–5 are on.
assert.equal(neteaseThirdPartySwitch(decodeToolboxMenu(before)), 0x3e, "the value verified on hardware");
assert.equal(neteaseThirdPartySwitch({ shown: [], hidden: [] }), 0x3a);
assert.equal(neteaseThirdPartySwitch({ shown: [0x11], hidden: [0x25] }), 0x3f);

// Unpacked repeated IDs and unknown fields are accepted.
assert.deepEqual(decodeToolboxMenu(Buffer.from("0801100220011a0408260801", "hex")), { shown: [TOOLBOX_NETEASE, 1], hidden: [] });
for (const bad of ["1a05", "1a020a05", "0b", "08ff", "1a01ff"])
  assert.throws(() => decodeToolboxMenu(Buffer.from(bad, "hex")), /invalid Toolbox list/, bad);
console.log("Watch Toolbox: menu decoding, NetEase state and the third-party switch value passed.");
