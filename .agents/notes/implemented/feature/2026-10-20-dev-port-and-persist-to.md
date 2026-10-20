# Agent Note: axioms dev takes --port and --persist-to

Status: implemented

## Problem

`axioms dev` ran wrangler on port 8787 and vite on port 5173 against wrangler's default local D1
state. Two agents, two git worktrees or a CI job could not run the app at the same time: the
second run failed with a port in use, or shared and changed the first run's database. In the A/B
eval (#11), all five factory audits bypassed `bun run dev` and ran the server package's wrangler
commands by hand to choose a port and a fresh state directory. A fresh project could not run
`axioms dev` at all: wrangler refuses to start while `apps/web/dist` does not exist.

`axioms smoke` already picked a random port and a throwaway state directory, with its own copy of
the wrangler command, the health wait and the stop.

## Decision

`axioms dev [--port <n>] [--persist-to <dir>]`.

- The app URL is vite's port. vite serves the web app and proxies `/api` to wrangler, so one URL
  serves the UI and the API. Without `--port`, vite keeps 5173 and wrangler keeps 8787. With
  `--port <n>`, vite takes `n` (0 picks a free port) and wrangler always takes a free port, so two
  runs with different `--port` values never ask for the same wrangler port. vite reads its port
  and the proxy target from `WEB_PORT` and `API_URL`, which `axioms dev` sets, and binds
  `127.0.0.1`, as wrangler does.
- `--persist-to <dir>` is resolved against the current directory. The D1 migrations are applied
  to that directory first, then `wrangler dev` reads the same directory. Without the flag both use
  wrangler's default `.wrangler/state`, as before.
- dev prints `axioms dev: app on <url> (wrangler dev on <url>, D1 state in <dir>)` as soon as both
  servers start, then `✓ dev: ready on <url>` once `/api/health` answers through the proxy.
- dev creates an empty `apps/web/dist` when it is missing, so wrangler starts on a fresh project.

One helper owns local servers: `cli/devserver.core.ts` builds the wrangler commands and parses
the dev arguments, and `cli/commands/devserver.ts` picks free ports, applies migrations, starts
`wrangler dev`, waits for `/api/health` and stops the server. `smoke`, `dev` and `e2e` all use it.

- `freePorts(n)` asks the OS for `n` ports and holds them all until every one is chosen, so they
  differ.
- Each wrangler gets its own `--inspector-port`. Without it, two servers that start at the same
  moment both find the default 9229 free and one fails with "Address already in use".
- Every server runs in its own process group. Stopping it sends SIGINT to the group, SIGKILL after
  5s, then SIGKILL to whatever is left, so workerd dies with its wrangler. SIGINT or SIGTERM to
  the CLI stops every server it started, then exits with 130 or 143. stdin is ignored, because a
  process outside the terminal's foreground group that reads the terminal is stopped by SIGTTIN.

`axioms smoke` keeps its phases, output, evidence report and `.wrangler/smoke` state directory.
Its port now comes from `freePorts` instead of a random pick between 8800 and 8999.

## Alternatives considered

- **`--port` sets wrangler's port, and vite stays on 5173.** Two runs would still collide on
  5173, and the URL printed would serve the API and the last build instead of the dev UI.
- **A random port in a fixed range, as smoke had.** Two runs can draw the same port, and nothing
  checks that the port is free.
- **Leave the processes in the CLI's process group.** Ctrl-C in a terminal reaches them, but an
  agent that sends SIGTERM to `axioms dev` only reaches the direct children, and a workerd whose
  wrangler was killed keeps running.
- **Build the web app before dev starts.** It costs a build on every start to serve files that
  vite already serves in development; an empty `dist` folder is enough for wrangler.

## Consequences

- Parallel agents, worktrees and CI each run `bun run dev --port 0 --persist-to <dir>` and read
  the URL from the output.
- vite binds `127.0.0.1` instead of `localhost`. A browser opening `http://localhost:5173` still
  reaches it; a client that only tries `::1` does not.
- dev's children no longer read the terminal, so the keyboard shortcuts of vite and wrangler are
  off.
- `apps/server`'s own `dev` script is no longer what `axioms dev` runs. It stays for running the
  worker alone and now binds `127.0.0.1`, where vite's default proxy points.

## Verification

- `bun test cli/devserver.core.test.ts`: argument parsing (every port from 0 to 65535 with
  fast-check, bad ports, missing values, repeated flags), the port plan, and the wrangler
  commands.
- `bun run selftest`: two `axioms dev --port 0 --persist-to <tmp>` runs start at once in one
  project. Each answers `/api/health` and `/api/widgets?id=abc` (a row only the migration
  inserts) on its own URL, and after SIGTERM no process from either tree is still running.
