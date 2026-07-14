import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MockCatalogAdapter } from "./catalog-adapter.mjs";
import { runLineageGuard } from "./agent.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const input = JSON.parse(await fs.readFile(path.join(__dirname, "../examples/risky-change.json"), "utf8"));
const result = await runLineageGuard({ datasetUrn: input.datasetUrn, changeRequest: input.changeRequest, catalog: new MockCatalogAdapter() });
await fs.writeFile(path.join(__dirname, "../examples/sample-output.json"), JSON.stringify(result, null, 2));
await fs.writeFile(path.join(__dirname, "../examples/generated-pr-review.md"), result.prMarkdown);
console.log(JSON.stringify({ score: result.score, severity: result.severity, decision: result.decision, impacted: result.impactedAssets.length }, null, 2));
