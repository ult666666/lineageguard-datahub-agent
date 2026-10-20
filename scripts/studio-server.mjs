#!/usr/bin/env node
import {
  LaunchError,
  parseLaunchArgs,
  supportedNode,
  launchStudio,
  openStudio,
} from '../src/studio/launch.mjs';

const HELP = `LineageGuard Studio — local launcher

npm run studio:local                 Start a foreground local server, or identify the existing one.
npm run studio:status                Read-only availability/mode check; never opens SQLite or starts a server.
npm run studio:open                  Open the existing verified local service in your browser.
npm run studio:local -- --open       Start if needed, then open the browser.

Options: --port=4183 --store=/absolute/directory --preview --status --open --json --help
The host is always 127.0.0.1. No process is killed, no port is changed automatically,
and an occupied port never silently substitutes an explicitly requested --store.
Existing-service metadata does not prove process ownership or its storage path.
Keep the original server terminal open. Its Ctrl+C stops only that foreground service.
`;
const machine = process.argv.slice(2).includes('--json');
function output(report) {
  if (machine) console.log(JSON.stringify(report));
  else {
    console.log(report.message);
    if (report.url) console.log(`\n  ${report.url}\n`);
    if (report.runtime) console.log(`Runtime: ${report.runtime} · application ${report.version}`);
    if (report.code === 'NOT_RUNNING') console.log('Start command: npm run studio:local');
    if (report.browserOpened === false)
      console.log('The browser could not be opened automatically; copy the URL above.');
  }
}
try {
  const options = parseLaunchArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
  } else {
    if (!supportedNode(process.versions.node))
      throw new LaunchError(
        'NODE_VERSION',
        'Use Node 22.13+ below Node 25; Node 24 is recommended. No local service was started.',
      );
    const result = await launchStudio(options);
    if (result.app) {
      let closing = false;
      const close = async () => {
        if (closing) return;
        closing = true;
        try {
          await result.app.close();
          process.exitCode = 0;
        } catch {
          output({
            code: 'CLOSE_FAILED',
            message:
              'This foreground server could not finish closing its own resources. Its existing database was not deleted.',
          });
          process.exitCode = 1;
        }
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
    }
    if (options.open && result.exitCode === 0)
      result.report.browserOpened = await openStudio(options.port);
    output(result.report);
    if (!result.app)
      process.exitCode = result.exitCode || (result.report.browserOpened === false ? 1 : 0);
  }
} catch (error) {
  output({
    app: 'LineageGuard Studio',
    state: 'unavailable',
    code: error instanceof LaunchError ? error.code : 'LAUNCH_FAILED',
    message:
      error instanceof LaunchError
        ? error.message
        : 'Studio could not finish the local launch check. No existing process was stopped.',
    processStarted: false,
    storeVerified: false,
    executionAuthorized: false,
  });
  process.exitCode = 1;
}
