# LineageGuard

LineageGuard is a DataHub-context agent that reviews schema changes before they break downstream datasets, dashboards, pipelines, or ML models.

It reads ownership, usage, quality signals, and lineage through the DataHub MCP Server; scores the blast radius; and generates:

- a block / approval / proceed decision;
- owner notifications;
- staged migration SQL;
- validation tests;
- PR-ready review notes; and
- an approval-gated DataHub write-back plan.

## Why this matters

Schema changes are often reviewed from the edited table alone. DataHub knows the real blast radius: downstream consumers, owners, quality assertions, and usage. LineageGuard converts that context into a safe, reproducible change workflow.

## Run the demo

Requirements: Node.js 20+; no package installation is required.

```bash
npm test
npm run demo
npm start
```

Open `http://127.0.0.1:4173`, click **Load risky demo**, and run the analysis.

The server binds to `127.0.0.1:4173` by default. Override either value when needed:

```bash
HOST=0.0.0.0 PORT=8080 npm start
```

## Run with Docker

Requirements: Docker Engine or Docker Desktop.

Build the production image and run its test suite:

```bash
docker build -t lineageguard:local .
docker run --rm lineageguard:local npm test
```

Start LineageGuard in mock-data mode:

```bash
docker run --rm --name lineageguard -p 4173:4173 lineageguard:local
```

Open `http://127.0.0.1:4173` or verify the service directly:

```bash
curl --fail http://127.0.0.1:4173/api/health
```

To use a live DataHub MCP Server, pass credentials at runtime rather than storing them in the image:

```bash
docker run --rm --name lineageguard \
  -p 4173:4173 \
  -e DATAHUB_MCP_URL="https://<tenant>.acryl.io/integrations/ai/mcp/" \
  -e DATAHUB_MCP_TOKEN="<service-account-or-personal-token>" \
  lineageguard:local
```

The image runs as the unprivileged `node` user and includes a health check against `/api/health`.

## Connect a live DataHub MCP Server

The included snapshot keeps the demo reproducible. For live DataHub metadata, set:

```bash
export DATAHUB_MCP_URL="https://<tenant>.acryl.io/integrations/ai/mcp/"
export DATAHUB_MCP_TOKEN="<service-account-or-personal-token>"
npm start
```

LineageGuard calls the DataHub MCP tools `get_entities` and `get_lineage`. Mutation is deliberately approval-gated: the first release generates a write-back proposal rather than changing catalog state automatically.

## Architecture

```text
Change request
   │
   ▼
LineageGuard agent ──► DataHub MCP ──► schema, owners, usage, quality, lineage
   │
   ├── blast-radius scoring
   ├── staged migration SQL
   ├── validation checklist
   ├── PR review document
   └── approval-gated DataHub write-back plan
```

## Hackathon track

Primary: **Agents That Do Real Work**. Secondary: **Metadata-Aware Code Generation & Development**.

The project is newly created during the July 6–August 10, 2026 submission window. DataHub is the required context layer, and the MCP Server is the required agent integration.

## Safety model

- Read operations are automatic.
- Schema changes are never executed by the app.
- DataHub mutations remain proposed until an authorized person approves them.
- Migration SQL is additive by default and includes explicit validation gates.
- The demo contains synthetic metadata only.

## Repository status

This is the local MVP. Before submission it still needs a live DataHub test tenant, a public Apache-2.0 repository, hosted demo, public screen-demo video under three minutes, and Devpost registration.
