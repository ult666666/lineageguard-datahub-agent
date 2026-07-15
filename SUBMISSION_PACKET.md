# LineageGuard — Build with DataHub Devpost packet

Verified against the official rules on July 14, 2026.

- Hackathon: <https://datahub.devpost.com/>
- Official rules: <https://datahub.devpost.com/rules>
- Deadline: **August 10, 2026 at 5:00 PM EDT**
- Target: **$3,000 Challenge Winner — Metadata-Aware Code Generation & Development**
- Budget: **USD 0**

## No-presentation category check

The official prize table lists a **Presentation at DataHub Townhall only under the $6,000 Grand Prize**.

The four $3,000 Challenge Winner prizes list:

- $3,000;
- DataHub social/Slack promotion; and
- a special LinkedIn badge.

The rules do not list an interview, call, live pitch, or presentation for a Challenge Winner. They do require normal post-win identity, eligibility, and role verification plus winner affidavits and possible tax/payment forms. Those forms are required only if selected as a potential winner and are not an interview.

### Strict caveat

The Grand Prize is open to **all eligible submissions**, and the published rules do not provide a way to opt out of Grand Prize consideration. Each eligible submission can receive only one prize.

Therefore, the **category award itself is no-presentation**, but the overall submission cannot be guaranteed presentation-free unless DataHub confirms in writing that the entrant may opt out of Grand Prize consideration while remaining eligible for a Challenge Winner or Honourable Mention. Otherwise, the entrant would need to decline a Grand Prize if selected and a Townhall presentation is unacceptable.

### Clarification email — send before final submission

**Status:** Sent July 14, 2026 from `charles@madebymotionx.com`; Gmail thread ID `19f64ca7aaee1f8e`. Awaiting written reply.

**To:** lakshay@datahub.com

**Subject:** Can an entrant opt out of Grand Prize consideration?

> Hi Lakshay,
>
> I plan to submit LineageGuard to the Metadata-Aware Code Generation & Development category. I can accept a Challenge Winner or Honourable Mention prize, but I cannot participate in a live presentation. The official rules list a DataHub Townhall presentation only for the Grand Prize, while also making all eligible submissions eligible for the Grand Prize.
>
> Can I opt out of Grand Prize consideration while remaining fully eligible for a Challenge Winner and Honourable Mention? Please confirm in writing before I submit.
>
> Thank you,
>
> Chunyu Dai

## Category strategy

Select exactly:

**Metadata-Aware Code Generation & Development**

Do not lead with **Agents That Do Real Work**. That category says the agent writes results back to DataHub. LineageGuard deliberately keeps DataHub mutation approval-gated and currently produces a write-back proposal rather than performing a mutation.

The selected category is a direct fit: LineageGuard reads DataHub schemas, ownership, usage signals, quality context, tags, and downstream lineage before generating migration SQL, validation checks, owner notifications, and a PR-ready review artifact.

## Exact Devpost field copy

### Project name

LineageGuard

### Tagline

DataHub-grounded schema reviews that block risky changes and generate merge-ready migration plans.

### Challenge category

Metadata-Aware Code Generation & Development

### DataHub technologies used

- DataHub MCP Server

Only select additional DataHub technologies if they are actually added and tested before submission.

### Built with

- DataHub MCP Server
- Node.js 20
- Model Context Protocol
- JSON-RPC 2.0
- Streamable HTTP
- JavaScript
- HTML
- CSS
- Vercel

### Try-it-out URL

<https://lineageguard-datahub-agent.vercel.app>

### Public repository URL

<https://github.com/ult666666/lineageguard-datahub-agent>

Before submission, confirm the DataHub MCP fixes and submission packet are on the repository's default branch.

### Demo video URL

**PENDING — add a new DataHub-tailored YouTube or Vimeo URL with Public visibility.**

Do not use <https://youtu.be/yMaMvqcoV7w> for this entry. It is an OpenAI Build Week asset, is unlisted, and spends much of its runtime on Codex-specific material rather than the DataHub judging criteria.

### Short description

LineageGuard is a DataHub-context schema-change reviewer. It reads the target dataset and downstream lineage through the DataHub MCP Server, scores the operational blast radius, blocks dangerous changes, and generates additive migration SQL, validation checks, owner notifications, and a PR-ready review before merge. The hosted demo uses a disclosed synthetic DataHub-shaped snapshot so anyone can test it without credentials; the same adapter supports a live managed DataHub MCP endpoint.

## Project story — paste-ready

### Inspiration

A schema edit can look harmless in one pull request while silently breaking finance dashboards, ML features, pipelines, and customer-facing workflows. The missing ingredient is organizational context. DataHub already knows what depends on the table, who owns it, how heavily it is used, which quality signals protect it, and which governance tags apply. LineageGuard turns that metadata into a change-safety review before production breaks.

### What it does

LineageGuard accepts a DataHub dataset URN and a structured schema-change request. It retrieves the dataset and downstream lineage, then evaluates breaking-change severity, impacted asset types, ownership gaps, recent usage, sensitive-data tags, and quality context.

It returns one clear decision — block, approval required, or proceed with checks — and generates the artifacts an engineering team needs before merge:

- additive migration SQL;
- failed-cast and compatibility validation checks;
- downstream-owner notifications;
- a PR-ready blast-radius review; and
- an approval-gated DataHub write-back plan.

The app never executes production SQL. DataHub reads are automatic; catalog or schema mutations remain behind human approval.

### How we built it

The app uses Node.js 20 with no runtime dependencies. A DataHub MCP adapter implements the Streamable HTTP and JSON-RPC 2.0 flow, negotiates one MCP session, and calls the official read-only tools:

- `get_entities` with the target dataset URN; and
- `get_lineage` with `upstream: false`, `max_hops`, pagination, and result limits.

The adapter normalizes DataHub entity, ownership, platform, tag, 30-day usage, and downstream `searchResults` structures into the risk engine. A deterministic analysis layer scores the blast radius and generates SQL, tests, notifications, and Markdown. The public browser demo uses a synthetic DataHub-shaped catalog for free and repeatable evaluation.

For credential-free integration testing, `npm run mcp:smoke` starts an ephemeral local Streamable HTTP MCP server, verifies initialization/session behavior, validates the exact DataHub tool arguments and response shapes, and shuts down without writing credentials or keeping a port open.

### Challenges we ran into

The main challenge was preserving safety without reducing the product to a warning banner. LineageGuard needs to create useful code and validation artifacts while never silently executing a destructive migration.

The second challenge was making the DataHub path testable without publishing tenant credentials. We separated the catalog adapter from the deterministic risk engine, provided a disclosed synthetic snapshot for the hosted demo, and added a bounded local MCP transport smoke test. This proves the client handshake, official tool-call shapes, and response normalization without pretending the snapshot is a live tenant.

### Accomplishments that we're proud of

- A working browser and JSON API demo.
- A corrected DataHub MCP Streamable HTTP client with single-session initialization.
- Official `get_entities` and downstream `get_lineage` argument shapes.
- Normalization limited to true downstream search results, avoiding unrelated nested URNs.
- Additive migration SQL and validation gates instead of destructive execution.
- PR-ready sample output in the public repository.
- Ten passing automated tests, including a credential-free local MCP smoke flow.
- A dependency-free Node runtime, public Apache-2.0 repository, and USD 0 operating cost.

### What we learned

Metadata becomes much more useful when it changes an engineering decision. Lineage, ownership, usage, tags, and quality signals should not be separate dashboard tabs; together they can determine whether a migration is safe and what compatibility work is required.

We also learned that a trustworthy agent needs a clear authority boundary. LineageGuard can interpret context and generate artifacts, but production execution and metadata mutation remain explicit human decisions.

### What's next for LineageGuard

- Validate the adapter against a dedicated live DataHub test tenant.
- Add column-level lineage and `list_schema_fields` for field-specific impact analysis.
- Add dbt, Avro, protobuf, OpenAPI, and GraphQL change adapters.
- Open pull requests automatically after an authorized user approves the generated artifacts.
- Add an optional governed DataHub proposal/write-back flow after explicit approval.

## Judge testing instructions — paste-ready

### Fastest path: hosted demo

1. Open <https://lineageguard-datahub-agent.vercel.app>.
2. Click **Load risky demo**.
3. Click **Analyze with LineageGuard**.
4. Review the critical block decision, downstream blast radius, owners, staged migration SQL, validation checks, generated PR review, and agent trace.

The hosted demo clearly uses a synthetic DataHub-shaped snapshot so it works without credentials. It does not claim to be a live tenant.

### Local verification

Requirements: Node.js 20+. No package installation or paid service is required.

```bash
git clone https://github.com/ult666666/lineageguard-datahub-agent.git
cd lineageguard-datahub-agent
npm test
npm run mcp:smoke
npm start
```

Open <http://127.0.0.1:4173>.

`npm run mcp:smoke` uses only `127.0.0.1` and an ephemeral port. It validates one MCP initialization, session and protocol headers, `get_entities`, downstream `get_lineage`, official argument shapes, SSE/JSON response handling, and downstream asset normalization. It does not need a DataHub tenant.

### Optional live DataHub MCP mode

```bash
export DATAHUB_MCP_URL="https://<tenant>.acryl.io/integrations/ai/mcp/"
export DATAHUB_MCP_TOKEN="<service-account-or-personal-token>"
npm start
```

Credentials are read only at runtime and are never committed.

## New-project and licensing disclosure

- The entire LineageGuard project was created during the July 6–August 10, 2026 submission period.
- Work began inside the submission window; the first public repository commit is `9c8fe18` dated July 14, 2026.
- The project uses standard Node.js APIs and no runtime package dependencies.
- The portable Codex skill in `skills/` was also added during the submission window and is disclosed as an additional interface to the same risk policy.
- GitHub currently detects the repository license as **Apache License 2.0**.
- The public demo uses synthetic metadata owned by the entrant.

## Required media checklist

- [x] Hosted project URL works without login.
- [x] Public repository exists.
- [x] Repository includes all source, examples, screenshots, and instructions.
- [x] GitHub detects Apache-2.0.
- [x] Sample output exists in `examples/`.
- [x] Six DataHub demo screenshots exist in `assets/`.
- [ ] Record the separate DataHub-tailored video from `DATAHUB_DEMO_SCRIPT.md`.
- [ ] Keep the final video under 3:00; target 2:20–2:40.
- [ ] Show the project actually functioning on screen.
- [ ] State that the hosted demo uses a synthetic snapshot.
- [ ] Show `npm run mcp:smoke` succeeding.
- [ ] Use entrant-owned narration and no copyrighted music.
- [ ] Upload to YouTube or Vimeo with **Public** visibility.
- [ ] Confirm the video opens in a logged-out/private window.
- [ ] Paste the new public video URL into Devpost.

## Final Devpost checklist

- [ ] Sign in and join the DataHub hackathon.
- [ ] Send the Grand Prize opt-out clarification to lakshay@datahub.com and save the written reply if strict no-presentation is required.
- [ ] Personally accept the official rules and complete any CAPTCHA.
- [ ] Use the legal entrant identity for eligibility and prize paperwork.
- [ ] Create one project named **LineageGuard**.
- [ ] Select **Metadata-Aware Code Generation & Development**.
- [ ] Select **DataHub MCP Server** under technologies used.
- [ ] Paste the exact project story above.
- [ ] Add the hosted demo URL.
- [ ] Add the public repository URL.
- [ ] Add the new public DataHub video URL.
- [ ] Add at least the landing, request, result, impact, artifacts, and trace screenshots.
- [ ] Paste the judge testing instructions.
- [ ] Disclose that the hosted demo uses synthetic DataHub-shaped metadata.
- [ ] Disclose the July 14 first public commit and all pre-existing/standard tools accurately.
- [ ] Optional: complete one actionable feedback survey only if the feedback is genuine and specific.
- [ ] Preview the public project page and test every link while logged out.
- [ ] Submit before **August 10, 2026 at 5:00 PM EDT**.
- [ ] Save the final Devpost URL and submission confirmation.

## Post-win facts to keep ready

No action is needed unless selected as a potential winner. At that point Devpost/DataHub may request:

- legal identity and age/eligibility verification;
- verification of the entrant's role in creating the submission;
- a winner affidavit and other required forms within ten business days;
- a W-9 for a U.S. resident or other applicable tax form; and
- payment/bank information for prize delivery.

Do not provide sensitive tax or bank data anywhere except the official verified prize-fulfillment process.

The publicity clause also allows the Sponsor, Devpost, and their partners to use the entrant's name, likeness, photograph, voice, opinions, comments, hometown, and country for hackathon promotion. This is not a live-appearance requirement, but it is part of the entry terms.
