# Local launch reliability

This follow-up to Studio 2.0 fixes duplicate starts and adds read-only status/browser commands. The web application, review policy, database format and checkpoint bindings remain version 2.0.0. The original `v2.0.0` release tag is preserved; the commands in this page require the subsequent launcher update on `main` or its reviewed commit. This is not a new orchestration engine or a cloud-service change.

## Everyday commands

Run these inside your existing checkout. Do not clone again merely to open the page.

```sh
npm run studio:local
npm run studio:status
npm run studio:open
```

`studio:local` starts the foreground local server when the port is free. Leave that original terminal open while using Studio. Repeating the command while a matching Studio is already running gives its URL and returns successfully instead of printing an `EADDRINUSE` stack trace. It does not start a replacement or initialize a new database during that ordinary repeat-start path.

`studio:status` performs a bounded read-only GET. It does not import the SQLite service, create a storage directory or start a listener. A compatible running service returns exit code 0; stopped, conflicting, unresponsive or inconclusive observations return a nonzero exit code with an explanation.

`studio:open` checks the service first and asks the operating system to open its loopback URL. It does not start a missing server. When starting from scratch and opening the browser is desired, use:

```sh
npm run studio:local -- --open
```

Browser launching is best-effort: macOS uses `/usr/bin/open`; Linux uses `xdg-open`; Windows uses `rundll32.exe`. Commands are executed directly with a fixed, generated loopback URL and no shell interpolation. Native desktop execution is verified on the user's Mac; other-platform command selection is covered by the implementation rather than a claimed Windows/Linux desktop acceptance test. Failure to open a browser leaves a successfully started server available and prints its URL.

## Status for scripts

For one JSON record without npm's normal banner:

```sh
node scripts/studio-server.mjs --status --json
```

The report includes `state`, `code`, `url`, `version`, `runtime`, `processStarted` and `storeVerified`. Status and duplicate-launch reports set `storeVerified=false`: a public metadata response is not proof of the process owner, filesystem path, database health or integrity of every stored run. No database contents or remote error body are emitted.

Use the same explicit port for all commands when you chose a different one:

```sh
npm run studio:local -- --port=4190
npm run studio:status -- --port=4190
npm run studio:open -- --port=4190
```

The port must be an integer from 1 to 65535. Duplicate options, unknown capabilities and ambiguous numeric values are rejected. The host cannot be changed from `127.0.0.1`.

## Collision and data boundaries

A compatible service must report the expected schema, application version and runtime mode with SQL execution, catalog mutation and model inference disabled. An unrelated listener, different version, mismatched runtime, malformed or oversized response, redirect, incomplete body or connection failure is not silently accepted as the desired server. The probe has a 1.5-second total deadline, an 8 KB header bound and a 65 KB body bound; it follows no redirects and sends no credentials.

An explicitly requested `--store` is never silently replaced with the storage behind an occupied port. The existing API intentionally does not disclose its private directory, so an occupied-port launch with `--store` refuses and suggests the status command. A healthy response does not authenticate the service.

No launcher path kills another process, chooses a new port automatically, deletes a database, clears a lock or installs a persistent operating-system service. There is an unavoidable race between a successful preflight and binding the port. If another process wins, the launcher closes only the resources created by its own attempt and rechecks the winner; it reports that the requested store may have been initialized during that race. It does not claim nothing happened in that path.

Press Ctrl+C in the original server terminal to stop that foreground service. Its committed local SQLite data is retained. A truly interrupted workflow still follows the existing writer-lease and explicit-recovery rules.

## Verification and compatibility

The initial duplicate-start regression preserves an actual paused run while launching a second CLI from another directory; the new directory must remain without `.lineageguard`. The tests also exercise actual foreign loopback servers, response limits, timeouts, stopped status, argument refusal, mode/version conflicts, browser command construction, a simulated competing bind, and a real foreground start/stop/restart that preserves the exact paused checkpoint.

A test initially observed a paused checkpoint before its writer-release `finally` block completed. The restart assertion now waits for both `status=paused` and `leaseActive=false`; no database or runtime code was changed to disguise that valid transition. Browser-opener exceptions and inconclusive connection handling also have failing-before/passing-after regressions.

The launcher requires Node 22.13+ below Node 25; Node 24 is recommended. No new npm dependency, paid API, production migration, catalog connection or trading-system change is introduced. Tests use only their own temporary databases and child processes. Existing application and security suites remain separate verification layers.
