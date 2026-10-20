// Explicitly tested handshake profile. MCP 2026-07-28's stateless era is not implied.
export const MCP_PROFILE = '2025-11-25';
const READ_TOOLS = new Set([
  'get_entities',
  'get_lineage',
  'list_schema_fields',
  'get_dataset_queries',
  'get_lineage_paths_between',
]);
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export class McpError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'McpError';
    this.code = code;
  }
}

async function readBounded(response, limit, signal) {
  if (!response.body) throw new McpError('EMPTY_RESPONSE', 'MCP response is empty');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit)
        throw new McpError('RESPONSE_LIMIT', 'MCP response exceeds the byte limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseEnvelope(text, type, id) {
  let packets;
  try {
    if (type.includes('application/json')) packets = [JSON.parse(text)];
    else if (type.includes('text/event-stream')) {
      packets = text
        .split(/\r?\n\r?\n/)
        .map((event) =>
          event
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n'),
        )
        .filter(Boolean)
        .map((data) => JSON.parse(data));
    } else throw new Error('unsupported content type');
  } catch (cause) {
    throw new McpError('MALFORMED_RESPONSE', 'MCP response is not a supported JSON envelope', {
      cause,
    });
  }
  const responses = packets.filter((p) => record(p) && Object.hasOwn(p, 'id'));
  if (responses.length !== 1 || responses[0].id !== id)
    throw new McpError('RESPONSE_ID', 'MCP response identity does not match request ID');
  const p = responses[0];
  if (p.jsonrpc !== '2.0' || Object.hasOwn(p, 'error') === Object.hasOwn(p, 'result'))
    throw new McpError('INVALID_ENVELOPE', 'Invalid MCP result envelope');
  if (Object.hasOwn(p, 'error'))
    throw new McpError('PROTOCOL_ERROR', 'MCP returned a protocol error');
  return p.result;
}

export class DataHubMcpClient {
  constructor({ url, token, fetchImpl = fetch, timeoutMs = 5000, maxResponseBytes = 1_000_000 }) {
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !['https:', 'http:'].includes(parsed.protocol) ||
      (parsed.protocol === 'http:' &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
    )
      throw new TypeError('MCP URL must use HTTPS or explicit loopback HTTP, without userinfo');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30000)
      throw new TypeError('Invalid MCP timeout');
    if (
      !Number.isInteger(maxResponseBytes) ||
      maxResponseBytes < 1024 ||
      maxResponseBytes > 2_000_000
    )
      throw new TypeError('Invalid MCP response limit');
    this.url = parsed.href;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
    this.nextId = 1;
    this.sessionId = null;
    this.protocolVersion = MCP_PROFILE;
    this.initialized = false;
    this.initializePromise = null;
  }
  async request(method, params = undefined, notification = false, { signal } = {}) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        const error = new McpError('TIMEOUT', 'MCP deadline timeout');
        reject(error);
        controller.abort(error);
      }, this.timeoutMs);
    });
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () =>
        reject(new McpError('CANCELLED', 'MCP request aborted', { cause: combined.reason }));
      combined.addEventListener('abort', abort, { once: true });
    });
    const payload = { jsonrpc: '2.0', method };
    if (!notification) payload.id = this.nextId++;
    if (params !== undefined) payload.params = params;
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    if (method !== 'initialize') headers['mcp-protocol-version'] = this.protocolVersion;
    try {
      return await Promise.race([
        deadline,
        cancelled,
        (async () => {
          const response = await this.fetchImpl(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: combined,
            redirect: 'error',
          });
          if (!response.ok)
            throw new McpError('HTTP_ERROR', `MCP request failed with HTTP ${response.status}`);
          if (notification) return null;
          const result = parseEnvelope(
            await readBounded(response, this.maxResponseBytes, combined),
            response.headers.get('content-type') || '',
            payload.id,
          );
          const session = response.headers.get('mcp-session-id');
          if (session && (session.length > 256 || /[^\x21-\x7e]/.test(session)))
            throw new McpError('INVALID_SESSION', 'Invalid MCP session identifier');
          if (session) this.sessionId = session;
          return result;
        })(),
      ]);
    } finally {
      clearTimeout(timeout);
      combined.removeEventListener('abort', abort);
    }
  }
  async initialize({ signal } = {}) {
    signal?.throwIfAborted();
    if (this.initialized) return;
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const result = await this.request(
          'initialize',
          {
            protocolVersion: MCP_PROFILE,
            capabilities: {},
            clientInfo: { name: 'lineageguard', version: '2.0.0' },
          },
          false,
          { signal },
        );
        if (
          !record(result) ||
          result.protocolVersion !== MCP_PROFILE ||
          !record(result.capabilities) ||
          !record(result.capabilities.tools)
        )
          throw new McpError(
            'UNSUPPORTED_PROFILE',
            'MCP protocol version or tools profile is unsupported',
          );
        await this.request('notifications/initialized', undefined, true, { signal });
        this.initialized = true;
      })();
    }
    try {
      await this.initializePromise;
    } finally {
      if (!this.initialized) this.initializePromise = null;
    }
  }
  async listTools(options = {}) {
    await this.initialize(options);
    return this.request('tools/list', {}, false, options);
  }
  async callTool(name, args, options = {}) {
    if (!READ_TOOLS.has(name))
      throw new McpError('CAPABILITY_DENIED', 'Tool is outside the read-only allowlist');
    await this.initialize(options);
    const result = await this.request('tools/call', { name, arguments: args }, false, options);
    if (!record(result) || result.isError === true)
      throw new McpError('TOOL_ERROR', 'MCP tool execution failed');
    return result;
  }
}

export function extractToolJson(result) {
  if (!record(result) || result.isError === true)
    throw new McpError('TOOL_ERROR', 'MCP tool execution failed');
  if (Object.hasOwn(result, 'structuredContent')) return structuredClone(result.structuredContent);
  const blocks = result.content;
  if (!Array.isArray(blocks))
    throw new McpError('TOOL_FORMAT', 'MCP tool result has no structured evidence');
  const text = blocks
    .filter((b) => record(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new McpError('TOOL_FORMAT', 'MCP tool result is not structured JSON evidence', { cause });
  }
}
