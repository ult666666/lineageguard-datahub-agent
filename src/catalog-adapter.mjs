import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataHubMcpClient, extractToolJson } from "./datahub-mcp-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function displayName(value, fallback = undefined) {
  if (!value) return fallback;
  if (typeof value === "string") return value;
  return value.editableProperties?.displayName
    || value.properties?.displayName
    || value.info?.displayName
    || value.properties?.name
    || value.name
    || value.username
    || fallback;
}

function ownerName(entity, fallback = undefined) {
  const owner = entity?.ownership?.owners?.[0]?.owner
    || entity?.owners?.[0]?.owner
    || entity?.owners?.[0]
    || entity?.owner;
  return displayName(owner, fallback);
}

function entityName(entity, fallback) {
  return entity?.name
    || entity?.editableProperties?.name
    || entity?.properties?.name
    || fallback;
}

function inferEntityType(entity) {
  const declared = String(entity?.type || "").replaceAll("_", "").toLowerCase();
  if (declared === "mlmodel" || entity?.urn?.includes("urn:li:mlModel:")) return "mlModel";
  if (declared === "datajob" || entity?.urn?.includes("urn:li:dataJob:")) return "pipeline";
  if (declared === "dashboard" || entity?.urn?.includes("urn:li:dashboard:")) return "dashboard";
  if (declared === "chart" || entity?.urn?.includes("urn:li:chart:")) return "chart";
  return declared || "dataset";
}

function tagNames(entity) {
  const tags = entity?.tags?.tags || entity?.tags || [];
  if (!Array.isArray(tags)) return [];
  return tags.map((entry) => {
    if (typeof entry === "string") return entry;
    return entry?.tag?.properties?.name
      || entry?.tag?.name
      || entry?.properties?.name
      || entry?.name;
  }).filter(Boolean);
}

function qualitySignals(entity) {
  const assertions = entity?.assertions?.assertions || entity?.assertions || entity?.qualitySignals || [];
  const values = Array.isArray(assertions) ? [...assertions] : [];
  if (entity?.health && Object.keys(entity.health).length) values.push(entity.health);
  return values;
}

function selectEntity(payload, datasetUrn) {
  const entities = Array.isArray(payload) ? payload : [payload];
  return entities.find((entity) => entity?.urn === datasetUrn)
    || entities.find((entity) => entity && !entity.error)
    || {};
}

function downstreamEntities(payload) {
  const container = payload?.downstreams || payload?.downstream;
  const results = container?.searchResults || container?.results || [];
  if (!Array.isArray(results)) return [];
  return results.map((result) => result?.entity || result).filter((entity) => entity?.urn);
}

function parseDatasetName(urn) {
  return urn?.split(",").at(-2) || urn;
}

function normalizeLiveCatalog(datasetUrn, entityPayload, lineagePayload) {
  const entity = selectEntity(entityPayload, datasetUrn);
  const downstream = downstreamEntities(lineagePayload)
    .filter((item, index, values) => item.urn !== datasetUrn && values.findIndex((candidate) => candidate.urn === item.urn) === index)
    .map((item) => ({
      urn: item.urn,
      name: entityName(item, parseDatasetName(item.urn)),
      type: inferEntityType(item),
      owner: ownerName(item),
    }));
  const directWeeklyQueries = Number(entity.weeklyQueries ?? entity.usageStats?.weeklyQueries);
  const queriesLast30Days = Number(entity.statsSummary?.queryCountLast30Days);
  const weeklyQueries = Number.isFinite(directWeeklyQueries)
    ? directWeeklyQueries
    : Number.isFinite(queriesLast30Days)
      ? Math.ceil((queriesLast30Days * 7) / 30)
      : 0;
  return {
    urn: datasetUrn,
    name: entityName(entity, parseDatasetName(datasetUrn)),
    platform: displayName(entity.platform, entity.platformName || "DataHub"),
    owner: ownerName(entity, "unassigned"),
    weeklyQueries,
    tags: tagNames(entity),
    qualitySignals: qualitySignals(entity),
    downstream,
    raw: { entityPayload, lineagePayload },
  };
}

export class MockCatalogAdapter {
  constructor(filePath = path.join(__dirname, "../data/sample-catalog.json")) {
    this.filePath = filePath;
    this.mode = "mock-datahub-snapshot";
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
    this.mode = "live-datahub-mcp";
  }
  async getDataset(datasetUrn) {
    const [entity, lineage] = await Promise.all([
      this.client.callTool("get_entities", { urns: [datasetUrn] }),
      this.client.callTool("get_lineage", {
        urn: datasetUrn,
        column: null,
        upstream: false,
        max_hops: 3,
        max_results: 100,
        offset: 0,
      }),
    ]);
    return normalizeLiveCatalog(datasetUrn, extractToolJson(entity), extractToolJson(lineage));
  }
}

export function createCatalogAdapter() {
  return process.env.DATAHUB_MCP_URL ? new DataHubMcpCatalogAdapter() : new MockCatalogAdapter();
}
