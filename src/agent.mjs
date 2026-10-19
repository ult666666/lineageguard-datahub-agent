import { validateRequest } from "./change-contract.mjs";
import { analyzeImpact } from "./impact-engine.mjs";

export async function runLineageGuard({ datasetUrn, changeRequest, catalog }) {
  changeRequest = validateRequest(datasetUrn, changeRequest);

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
    mode: catalog.mode || (process.env.DATAHUB_MCP_URL ? "live-datahub-mcp" : "mock-datahub-snapshot"),
    request: { datasetUrn, summary: changeRequest.summary || "Schema change review", changes: changeRequest.changes },
    trace,
    ...analysis,
  };
}
