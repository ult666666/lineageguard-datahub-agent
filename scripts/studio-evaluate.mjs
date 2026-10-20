import { evaluateSuite } from '../public/studio/core/evaluations.js';
const report = await evaluateSuite();
console.log(JSON.stringify(report, null, 2));
if (report.failed) process.exitCode = 1;
