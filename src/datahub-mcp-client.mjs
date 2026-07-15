function parseResponse(text, contentType) {
  if (contentType.includes("application/json")) return JSON.parse(text);
  const events = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return events.at(-1);
}

export class DataHubMcpClient {
  constructor({ url, token, fetchImpl = fetch }) {
    if (!url) throw new Error("DATAHUB_MCP_URL is required for live mode.");
    this.url = url;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
    this.sessionId = null;
    this.protocolVersion = "2025-11-25";
    this.initialized = false;
    this.initializePromise = null;
  }

  async request(method, params = undefined, notification = false) {
    const payload = { jsonrpc: "2.0", method };
    if (!notification) payload.id = this.nextId++;
    if (params !== undefined) payload.params = params;
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (method !== "initialize") headers["mcp-protocol-version"] = this.protocolVersion;

    const response = await this.fetchImpl(this.url, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`DataHub MCP ${method} failed: ${response.status} ${await response.text()}`);
    this.sessionId = response.headers.get("mcp-session-id") || this.sessionId;
    if (notification || response.status === 202) return null;
    const parsed = parseResponse(await response.text(), response.headers.get("content-type") || "");
    if (parsed?.error) throw new Error(parsed.error.message || JSON.stringify(parsed.error));
    return parsed?.result;
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const result = await this.request("initialize", {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: { name: "lineageguard", version: "0.1.0" },
        });
        this.protocolVersion = result?.protocolVersion || this.protocolVersion;
        try {
          await this.request("notifications/initialized", undefined, true);
          this.initialized = true;
        } catch (error) {
          this.initialized = false;
          throw error;
        }
      })();
    }
    try {
      await this.initializePromise;
    } finally {
      if (!this.initialized) this.initializePromise = null;
    }
  }

  async listTools() {
    await this.initialize();
    return this.request("tools/list", {});
  }

  async callTool(name, args) {
    await this.initialize();
    return this.request("tools/call", { name, arguments: args });
  }
}

export function extractToolJson(result) {
  const blocks = result?.content || [];
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
