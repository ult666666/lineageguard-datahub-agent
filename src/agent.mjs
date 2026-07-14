import { analyzeImpact } from "./impact-engine.mjs";

export async function runLineageGuard({ datasetUrn, changeRequest, catalog }) {
  if (!datasetUrn) throw new Error("datasetUrn is required.");
  if (!Array.isArray(changeRequest?.changes) || !changeRequest.changes.length) {
    throw new Error("changeRequest.changes must contain at least one schema change.");
  }

  const trace = [
    { step: "plan", status: "complete", detail: "Identify target dataset and proposed schema changes." },
    { step: "retrieve", status: "running", detail: "Read schemas, ownership, usage, and downstream lineage from DataHub MCP." },
  ];
  const dataset = await catalog.getDataset(datasetUrn);
  trace[1].status = "complete";
  trace.push({ step: "analyze", status: "complete", detail: `Evaluate blast radius across ${dataset.downstream?.length || 0} downstream assets.` });
  const analysis = analyzeImpact({ dataset, changes: changeRequest.changes });
  trace.push({ step: "generate", status: "complete", detail: "Generate staged migration SQL, validation tests, owner notifications, and PR notes." });
  trace.push({ step: "write-back", status: "proposed", detail: "Prepare a DataHub context/proposal update; mutation remains approval-gated." });

  return {
    id: `lg-${Date.now()}`,
    createdAt: new Date().toISOString(),
    mode: process.env.DATAHUB_MCP_URL ? "live-datahub-mcp" : "mock-datahub-snapshot",
    request: { datasetUrn, summary: changeRequest.summary || "Schema change review", changes: changeRequest.changes },
    trace,
    ...analysis,
  };
}
