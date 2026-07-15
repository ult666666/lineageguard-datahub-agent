import assert from "node:assert/strict";
import http from "node:http";
import { pathToFileURL } from "node:url";
import { runLineageGuard } from "../src/agent.mjs";
import { DataHubMcpCatalogAdapter } from "../src/catalog-adapter.mjs";

const DATASET_URN = "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.analytics.orders,PROD)";
const SESSION_ID = "lineageguard-local-smoke";
const TOKEN = "local-smoke-token";

const sourceEntity = {
  urn: DATASET_URN,
  type: "DATASET",
  name: "prod.analytics.orders",
  platform: { urn: "urn:li:dataPlatform:snowflake", name: "snowflake" },
  ownership: {
    owners: [{ owner: { urn: "urn:li:corpuser:commerce-data", properties: { displayName: "Commerce Data" } } }],
  },
  tags: { tags: [{ tag: { properties: { name: "Financial" } } }] },
  statsSummary: { queryCountLast30Days: 275 },
  health: { type: "PASSING" },
};

const lineagePayload = {
  downstreams: {
    total: 3,
    searchResults: [
      {
        entity: {
          urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,prod.finance.fct_revenue,PROD)",
          type: "DATASET",
          name: "prod.finance.fct_revenue",
          platform: { urn: "urn:li:dataPlatform:snowflake", name: "snowflake" },
          ownership: { owners: [{ owner: { urn: "urn:li:corpGroup:finance-analytics", properties: { displayName: "Finance Analytics" } } }] },
        },
      },
      {
        entity: {
          urn: "urn:li:dashboard:(looker,revenue-executive)",
          type: "DASHBOARD",
          properties: { name: "Executive Revenue Dashboard" },
          ownership: { owners: [{ owner: { urn: "urn:li:corpGroup:finance-analytics", properties: { displayName: "Finance Analytics" } } }] },
        },
      },
      {
        entity: {
          urn: "urn:li:dataJob:(airflow,revenue-close)",
          type: "DATA_JOB",
          properties: { name: "Monthly Revenue Close" },
        },
      },
    ],
  },
};

function toolResult(id, value) {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(value) }], isError: false },
  };
}

function sendJson(response, payload, session = true) {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  if (session) response.setHeader("mcp-session-id", SESSION_ID);
  response.end(JSON.stringify(payload));
}

function sendEvent(response, payload) {
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("mcp-session-id", SESSION_ID);
  response.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function runMockMcpSmoke() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const message = JSON.parse(body);
      calls.push({ method: message.method, params: message.params });

      assert.equal(request.method, "POST");
      assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);

      if (message.method === "initialize") {
        assert.equal(message.params.protocolVersion, "2025-11-25");
        sendJson(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "lineageguard-datahub-mock", version: "0.1.0" },
          },
        });
        return;
      }

      assert.equal(request.headers["mcp-session-id"], SESSION_ID);
      assert.equal(request.headers["mcp-protocol-version"], "2025-11-25");

      if (message.method === "notifications/initialized") {
        response.statusCode = 202;
        response.end();
        return;
      }

      assert.equal(message.method, "tools/call");
      if (message.params.name === "get_entities") {
        assert.deepEqual(message.params.arguments, { urns: [DATASET_URN] });
        sendJson(response, toolResult(message.id, [sourceEntity]));
        return;
      }
      if (message.params.name === "get_lineage") {
        assert.deepEqual(message.params.arguments, {
          urn: DATASET_URN,
          column: null,
          upstream: false,
          max_hops: 3,
          max_results: 100,
          offset: 0,
        });
        sendEvent(response, toolResult(message.id, lineagePayload));
        return;
      }
      throw new Error(`Unexpected tool: ${message.params.name}`);
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end(error.stack || error.message);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    const adapter = new DataHubMcpCatalogAdapter({
      url: `http://127.0.0.1:${address.port}/mcp`,
      token: TOKEN,
    });
    const dataset = await adapter.getDataset(DATASET_URN);

    assert.equal(dataset.name, "prod.analytics.orders");
    assert.equal(dataset.platform, "snowflake");
    assert.equal(dataset.owner, "Commerce Data");
    assert.equal(dataset.weeklyQueries, 65);
    assert.deepEqual(dataset.tags, ["Financial"]);
    assert.equal(dataset.downstream.length, 3);
    assert.equal(dataset.downstream[1].type, "dashboard");
    assert.equal(dataset.downstream[2].type, "pipeline");
    assert.equal(dataset.downstream[2].owner, undefined);

    const result = await runLineageGuard({
      datasetUrn: DATASET_URN,
      changeRequest: {
        summary: "Rename a revenue field",
        changes: [{ kind: "rename", field: "order_total", to: "gross_amount", type: "DECIMAL(12,2)" }],
      },
      catalog: { mode: adapter.mode, getDataset: async () => dataset },
    });

    assert.equal(result.mode, "live-datahub-mcp");
    assert.equal(result.impactedAssets.length, 3);
    assert.equal(calls.filter((call) => call.method === "initialize").length, 1);
    assert.deepEqual(
      calls.filter((call) => call.method === "tools/call").map((call) => call.params.name).sort(),
      ["get_entities", "get_lineage"],
    );

    return {
      ok: true,
      transport: "local Streamable HTTP mock",
      initializeCalls: 1,
      tools: ["get_entities", "get_lineage"],
      downstreamAssets: result.impactedAssets.length,
      decision: result.decision,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runMockMcpSmoke();
  console.log(JSON.stringify(result, null, 2));
}
