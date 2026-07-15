import test from "node:test";
import assert from "node:assert/strict";
import { runMockMcpSmoke } from "../scripts/mock-mcp-smoke.mjs";

test("DataHub MCP adapter completes a local Streamable HTTP smoke flow", async () => {
  const result = await runMockMcpSmoke();
  assert.equal(result.ok, true);
  assert.equal(result.initializeCalls, 1);
  assert.deepEqual(result.tools, ["get_entities", "get_lineage"]);
  assert.equal(result.downstreamAssets, 3);
});
