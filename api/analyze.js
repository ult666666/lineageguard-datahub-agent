import { createCatalogAdapter } from "../src/catalog-adapter.mjs";
import { runLineageGuard } from "../src/agent.mjs";

const catalog = createCatalogAdapter();

function parseBody(body) {
  if (body == null || body === "") return {};
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8"));
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);
    const result = await runLineageGuard({
      datasetUrn: body.datasetUrn,
      changeRequest: body.changeRequest,
      catalog,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}

