import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogAdapter } from "./catalog-adapter.mjs";
import { runLineageGuard } from "./agent.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const examplePath = path.join(__dirname, "../examples/risky-change.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const catalog = createCatalogAdapter();

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function serveStatic(urlPath, res) {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(path.resolve(publicDir) + path.sep) && target !== path.join(publicDir, "index.html")) return false;
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { "content-type": contentTypes[path.extname(target)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, mode: process.env.DATAHUB_MCP_URL ? "live-datahub-mcp" : "mock-datahub-snapshot" });
    }
    if (req.method === "GET" && url.pathname === "/api/demo") {
      return json(res, 200, JSON.parse(await fs.readFile(examplePath, "utf8")));
    }
    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(req);
      return json(res, 200, await runLineageGuard({ datasetUrn: body.datasetUrn, changeRequest: body.changeRequest, catalog }));
    }
    if (req.method === "GET" && await serveStatic(url.pathname, res)) return;
    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`LineageGuard running at http://${host}:${port}`);
  console.log(`Mode: ${process.env.DATAHUB_MCP_URL ? "live DataHub MCP" : "mock DataHub snapshot"}`);
});
