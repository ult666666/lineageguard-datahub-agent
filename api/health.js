export default function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    mode: process.env.DATAHUB_MCP_URL ? "live-datahub-mcp" : "mock-datahub-snapshot",
  });
}

