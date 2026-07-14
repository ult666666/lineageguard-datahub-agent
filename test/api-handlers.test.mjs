import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import healthHandler from "../api/health.js";
import demoHandler from "../api/demo.js";
import analyzeHandler from "../api/analyze.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("serverless health endpoint reports demo mode", async () => {
  const res = createResponse();
  await healthHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, "mock-datahub-snapshot");
});

test("serverless demo endpoint returns a runnable request", async () => {
  const res = createResponse();
  await demoHandler({ method: "GET" }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.datasetUrn, /^urn:li:dataset:/);
  assert.ok(res.body.changeRequest.changes.length > 0);
});

test("serverless analyze endpoint blocks the risky example", async () => {
  const example = JSON.parse(await fs.readFile(new URL("../examples/risky-change.json", import.meta.url), "utf8"));
  const res = createResponse();
  await analyzeHandler({ method: "POST", body: example }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision, "block");
  assert.equal(res.body.severity, "critical");
  assert.ok(res.body.impactedAssets.length >= 4);
});

