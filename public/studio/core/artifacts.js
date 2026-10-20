import { identifier, sqlType } from './contract.js';
const md = (value) =>
  String(value)
    .replace(/[<>]/g, (x) => (x === '<' ? '&lt;' : '&gt;'))
    .replaceAll('\r', '');
export function buildArtifacts(request, outputs, binding) {
  const p = outputs.policy,
    table = outputs.resolve.data.name;
  const fields = new Map(outputs.schema.data.fields.map((f) => [f.name, f]));
  const lines = [
    '-- LineageGuard Studio: review draft only. No SQL has been executed.',
    `-- Review binding: ${binding}`,
    `-- Decision: ${p.decision}. Evidence ready: ${p.evidenceReady}.`,
    '-- Dialect: Snowflake-style examples; validate against your actual platform.',
    '-- DDL is not represented as an atomic rollback transaction.',
  ];
  const permitted = p.evidenceReady && p.decision !== 'block';
  for (const c of request.changeRequest.changes) {
    const field = identifier(c.field);
    const prefix = permitted ? '' : '-- NOT CLEARED: ';
    if (c.kind === 'add')
      lines.push(`${prefix}ALTER TABLE ${table} ADD COLUMN ${field} ${sqlType(c.type)};`);
    else if (c.kind === 'rename') {
      const next = identifier(c.to),
        type = sqlType(c.type || fields.get(c.field)?.type || 'VARCHAR');
      lines.push(
        '-- Keep the original field until consumer migration is validated.',
        `${prefix}ALTER TABLE ${table} ADD COLUMN ${next} ${type};`,
        `${prefix}UPDATE ${table} SET ${next} = ${field} WHERE ${next} IS NULL;`,
        `${prefix}SELECT COUNT(*) FROM ${table} WHERE ${next} IS DISTINCT FROM ${field};`,
      );
    } else if (c.kind === 'type_change') {
      const target = identifier(`${field.slice(0, 115)}__next`);
      lines.push(
        '-- Shadow conversion draft. Investigate failed casts before any cutover.',
        `${prefix}ALTER TABLE ${table} ADD COLUMN ${target} ${sqlType(c.to)};`,
        `${prefix}UPDATE ${table} SET ${target} = TRY_CAST(${field} AS ${sqlType(c.to)});`,
        `${prefix}SELECT COUNT(*) FROM ${table} WHERE ${field} IS NOT NULL AND ${target} IS NULL;`,
      );
    } else
      lines.push(
        `-- ${c.kind} for ${field}: manual migration design required; no destructive statement generated.`,
      );
  }
  const checklist = [
    'Validate row counts, unique keys and null rates in an isolated environment.',
    'Have each downstream owner validate their observed consumers.',
    'Test dual-read compatibility before cutover.',
    'Design and rehearse platform-specific recovery; this draft is not a rollback plan.',
    'Refresh evidence and request a new review when any bound input changes.',
  ];
  const markdown = `# ${md(request.changeRequest.summary)}\n\n**${p.decision.toUpperCase()}** · evidence ${p.evidenceReady ? 'complete and current' : 'not ready'}\n\nTarget: \`${md(request.datasetUrn)}\`\n\n## Reasons\n${p.reasons.map((r) => `- ${md(r.detail)} (${r.code})`).join('\n')}\n\n## Evidence gaps\n${p.gaps.length ? p.gaps.map((g) => `- ${md(g.detail)}`).join('\n') : 'None detected within this bounded evidence scope.'}\n\n## Validation checklist\n${checklist.map((c) => `- [ ] ${c}`).join('\n')}\n\n## Reproducibility\nBinding: \`${binding}\`\nPolicy: ${p.version}\nEvidence: ${p.evidenceIds.map((id) => '`' + id + '`').join(', ')}\n\nThis is an AI-assisted engineering tool with deterministic runtime decisions. No model inference, catalog write or SQL execution occurred. A local acknowledgement is not authenticated organizational approval.\n`;
  return { sql: lines.join('\n') + '\n', markdown, checklist, executionAuthorized: false };
}
