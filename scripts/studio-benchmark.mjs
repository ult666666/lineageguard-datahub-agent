#!/usr/bin/env node
import fs from 'node:fs';
import {
  CASES_FILE,
  REPORT_FILE,
  formatReport,
  headline,
  loadCases,
  renderMarkdown,
  replaceBlock,
  runBenchmark,
} from '../src/studio/policy-benchmark.mjs';

const HELP = `Run the labelled policy benchmark through the Studio interpreter.

npm run studio:benchmark              Print metrics and every disagreement.
npm run studio:benchmark -- --json    Print the full report as JSON.
npm run studio:benchmark -- --check   Fail if evals/policy-report.json or the generated
                                      README and docs/EVALUATION.md text is out of date.
npm run studio:benchmark -- --write   Regenerate the report and the generated text.

The command exits with status 1 when any decision is more permissive than its label.`;
const DOCS = [
  [new URL('../README.md', import.meta.url), 'policy-benchmark:headline', headline],
  [new URL('../docs/EVALUATION.md', import.meta.url), 'policy-benchmark:results', renderMarkdown],
];

const args = process.argv.slice(2);
const unknown = args.filter((a) => !['--json', '--check', '--write', '--help'].includes(a));
if (unknown.length || (args.includes('--check') && args.includes('--write'))) {
  console.error(`Unsupported options: ${unknown.join(' ') || '--check with --write'}\n\n${HELP}`);
  process.exit(2);
}
if (args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

const report = await runBenchmark(loadCases(JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'))));
const text = formatReport(report);
const outputs = () => [
  [REPORT_FILE, text],
  ...DOCS.map(([file, name, render]) => [
    file,
    replaceBlock(fs.readFileSync(file, 'utf8'), name, render(report)),
  ]),
];
let stale = [];
if (args.includes('--write')) {
  for (const [file, content] of outputs()) fs.writeFileSync(file, content);
} else if (args.includes('--check')) {
  stale = outputs()
    .filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content)
    .map(([file]) => file.pathname.split('/').slice(-2).join('/'));
}

if (args.includes('--json')) process.stdout.write(text);
else {
  const s = report.summary;
  const pad = (x, n) => String(x).padEnd(n);
  const num = (x) => (x === null ? 'n/a' : x.toFixed(2));
  console.log(`Policy benchmark · policy ${report.policyVersion}`);
  console.log(headline(report));
  console.log(
    `Reason codes: precision ${num(report.reasons.micro.precision)}, recall ${num(report.reasons.micro.recall)} · ` +
      `evidence gaps: precision ${num(report.gaps.micro.precision)}, recall ${num(report.gaps.micro.recall)} · ` +
      `twins held: ${s.twinsHeld}/${s.twins}\n`,
  );
  console.log(
    `${pad('Outcome', 22)}${pad('Labelled', 10)}${pad('Predicted', 11)}Precision  Recall  F1`,
  );
  for (const outcome of report.decisions.outcomes) {
    const m = report.decisions.perOutcome[outcome];
    console.log(
      `${pad(outcome, 22)}${pad(m.labelled, 10)}${pad(m.predicted, 11)}${pad(num(m.precision), 11)}${pad(num(m.recall), 8)}${num(m.f1)}`,
    );
  }
  if (report.disagreements.length) {
    console.log('\nDisagreements (label → policy output):');
    for (const x of report.disagreements)
      console.log(`  ${pad(x.id, 40)}${x.expected} → ${x.observed} (${x.direction})`);
  }
}
if (stale.length) {
  console.error(
    `\nOut of date: ${stale.join(', ')}. Run npm run studio:benchmark -- --write and review the diff.`,
  );
  process.exitCode = 1;
}
if (report.summary.morePermissive > 0) {
  console.error('\nAt least one decision is more permissive than its label.');
  process.exitCode = 1;
}
