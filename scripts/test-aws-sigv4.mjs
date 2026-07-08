import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { signRequest, sha256Hex } = await import(
  `${distUrl("awsSigV4.js")}?cacheBust=${Date.now()}`
);

// SHA-256 of empty string (well-known constant).
assert.equal(
  sha256Hex(""),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
);

// AWS SigV4 test-suite "get-vanilla": GET https://example.amazonaws.com/
// with only host + x-amz-date signed, empty payload.
const { authorization } = signRequest({
  method: "GET",
  url: "https://example.amazonaws.com/",
  region: "us-east-1",
  service: "service",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  amzDate: "20150830T123600Z",
  signedHeaders: { host: "example.amazonaws.com" },
  payloadHash: sha256Hex("")
});

assert.equal(
  authorization,
  "AWS4-HMAC-SHA256 " +
    "Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
    "SignedHeaders=host;x-amz-date, " +
    "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
);

console.log("aws-sigv4 tests passed");
