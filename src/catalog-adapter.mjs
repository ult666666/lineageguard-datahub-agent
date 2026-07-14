import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataHubMcpClient, extractToolJson } from "./datahub-mcp-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function collectObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, output);
    return output;
  }
  output.push(value);
  for (const child of Object.values(value)) collectObjects(child, output);
  return output;
}

function firstValue(objects, keys, fallback = undefined) {
  for (const object of objects) {
    for (const key of keys) if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return fallback;
}

function normalizeLiveCatalog(datasetUrn, entityPayload, lineagePayload) {
  const entityObjects = collectObjects(entityPayload);
  const lineageObjects = collectObjects(lineagePayload);
  const downstream = [];
  const seen = new Set();
  for (const object of lineageObjects) {
    const urn = object.urn || object.entityUrn || object.destinationUrn;
    if (!urn || urn === datasetUrn || seen.has(urn)) continue;
    seen.add(urn);
    downstream.push({
      urn,
      name: object.name || object.displayName || urn.split(",").at(-1)?.replace(/\).*/, "") || urn,
      type: object.type || object.entityType || (urn.includes("dashboard") ? "dashboard" : urn.includes("mlModel") ? "mlModel" : "dataset"),
      owner: object.owner || object.ownerName || object.ownership?.owners?.[0]?.owner,
    });
  }
  return {
    urn: datasetUrn,
    name: firstValue(entityObjects, ["name", "displayName"], datasetUrn),
    platform: firstValue(entityObjects, ["platform", "platformName"], "DataHub"),
    owner: firstValue(entityObjects, ["owner", "ownerName"], "unassigned"),
    weeklyQueries: Number(firstValue(entityObjects, ["weeklyQueries", "queryCount", "usageCount"], 0)),
    tags: entityObjects.flatMap((object) => object.tags || []).map((tag) => tag.name || tag.tag || tag).filter(Boolean),
    qualitySignals: entityObjects.flatMap((object) => object.assertions || object.qualitySignals || []),
    downstream,
    raw: { entityPayload, lineagePayload },
  };
}

export class MockCatalogAdapter {
  constructor(filePath = path.join(__dirname, "../data/sample-catalog.json")) {
    this.filePath = filePath;
  }
  async getDataset(datasetUrn) {
    const catalog = JSON.parse(await fs.readFile(this.filePath, "utf8"));
    const dataset = catalog.datasets.find((item) => item.urn === datasetUrn) || catalog.datasets[0];
    return structuredClone(dataset);
  }
}

export class DataHubMcpCatalogAdapter {
  constructor({ url = process.env.DATAHUB_MCP_URL, token = process.env.DATAHUB_MCP_TOKEN } = {}) {
    this.client = new DataHubMcpClient({ url, token });
  }
  async getDataset(datasetUrn) {
    const [entity, lineage] = await Promise.all([
      this.client.callTool("get_entities", { urns: [datasetUrn] }),
      this.client.callTool("get_lineage", { urn: datasetUrn, direction: "downstream", maxHops: 3, count: 100 }),
    ]);
    return normalizeLiveCatalog(datasetUrn, extractToolJson(entity), extractToolJson(lineage));
  }
}

export function createCatalogAdapter() {
  return process.env.DATAHUB_MCP_URL ? new DataHubMcpCatalogAdapter() : new MockCatalogAdapter();
}
