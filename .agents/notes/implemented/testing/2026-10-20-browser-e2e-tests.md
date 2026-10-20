# Agent Note: Saved browser tests and axioms e2e

Status: implemented

## Problem

The factory had no place for a browser test. Unit tests, route tests and smoke tests never load
the page a user sees, so a route that renders nothing or a web app that calls the API wrong
passes every gate. In the A/B eval (#11) the prompt asked that every feature work in the browser:

- All three Opus factory runs checked this with throwaway scripts outside the repo, so nothing
  reran them.
- One change-request run left three `wrangler dev` servers from its browser script running for
  over 40 minutes, which kept its process from exiting.
- Both Opus control runs, with no factory, committed `e2e/browser.ts` and extended it with each
  change request.

## Decision

The template has an `apps/web/e2e/` folder of saved browser tests, and they run in CI and in the
pre-push hook.

- **Tests.** `apps/web/e2e/*.e2e.ts` are `bun:test` files that drive Playwright's headless
  chromium against `E2E_URL`. The template ships `health.e2e.ts`: it opens `/`, waits for the
  status the health route renders, compares the version with `/api/health`, and fails on any
  uncaught page error. The `.e2e.ts` suffix keeps them out of `bun test` discovery, so
  `axioms check` never needs a server. They typecheck as their own TypeScript project
  (`apps/web/e2e/tsconfig.json`, referenced from the root `tsconfig.json`) with Bun's types,
  which the web app's `src` never sees. The shared Biome config treats `**/e2e/**` outside `src/`
  as tooling, like `smoke/`, and fallow counts `**/*.e2e.ts` as entry points.
- **`axioms e2e [--json] [--report <path>]`** runs these phases as gates and stops at the first
  failure: find the test files (none fails the run), build the web app, install the headless
  chromium (`playwright install chromium-headless-shell`, a no-op once cached), apply the D1
  migrations to a fresh directory under the OS temp folder, start `wrangler dev` on a free port,
  wait for `/api/health`, then `bun test --timeout 30000 ./e2e/<file>...` with `E2E_URL` set. The
  server comes from the shared helper of
  [dev-port-and-persist-to](../feature/2026-10-20-dev-port-and-persist-to.md): it runs in its own
  process group, and `axioms e2e` always stops it, when a test fails, when a phase crashes and on
  SIGINT or SIGTERM. The persist directory is removed afterwards. In a lite project
  (`axioms adopt`) the command passes with a skip message, since the shared pre-push hook calls
  it and there is no web app.
- **Where it runs.** The template's `ci.yml` has an `e2e` job (pinned actions,
  `persist-credentials: false`) whose steps `axioms ci-dry-run` replays as written, because the
  command installs its own browser. `harness/lefthook.yml` runs `bunx axioms e2e` as the last
  pre-push job. `harness/github.rules.json` requires the `e2e` status check. The Claude Code
  allowlist has `bun run e2e` and `bunx axioms e2e`.
- **Doctor.** `axioms doctor` fails an app project whose `ci.yml` has no must-pass
  `axioms e2e` step. For every profile it fails when the harness's pre-push hook has no `e2e` job
  that runs `axioms e2e` unconditionally, and when the project's `lefthook.yml` sets
  `pre-push.skip` or defines its own pre-push `e2e` job or command, which lefthook would merge
  over the harness one.
- **The canon.** The slice checklist says a user-visible feature adds or extends a browser test in
  `apps/web/e2e/`, and a rule says where the tests run and what doctor checks.

### Why Playwright

Playwright's `playwright` package (the library, pinned to an exact version in `apps/web`) runs
under Bun, starts headless chromium in about a second, and downloads that chromium with one
command that needs neither root nor a system Chrome. The download is cached per machine
(`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux), so a dev Mac and
a CI runner use the same browser build that the pinned version expects. The package has no
install script, so `bun install` does not need to trust one.

## Alternatives considered

- **puppeteer.** It downloads Chrome in a `postinstall` script, which Bun blocks unless the
  project trusts the package. A blocked script leaves tests that fail at launch.
- **puppeteer-core or playwright-core with the system Chrome.** No download, but every machine
  needs a Chrome at a known path. GitHub's Ubuntu image has one; a dev Mac may not, and its
  version drifts from what the driver was tested with.
- **`@playwright/test` as the runner.** It brings a second test runner and config file. `bun:test`
  already runs every other test here, and the tests need only the browser.
- **A Bun-native browser API.** Bun 1.3.6, the version the template pins, has none.
- **Vitest browser mode.** It tests components in a browser, not the built app served by the
  worker, which is what the eval runs checked by hand.
- **Run e2e inside `axioms smoke`.** One command would hide which kind of check failed, and smoke
  stays fast with no browser download.
- **Only in CI, not in pre-push.** The maintainer decided both: a push that breaks the page fails
  on the machine that made it.

## Consequences

- Every push in an app project builds the web app and runs the browser tests, about 15 seconds on
  a warm cache. The first run on a machine downloads chromium (about 100 MB).
- The CI job downloads chromium on every run; there is no cache step. On Ubuntu the headless
  shell relies on the libraries the GitHub image already ships, since `--with-deps` would need
  root on a developer's Linux machine during `ci-dry-run`. A runner image without them would
  fail at launch; the fix then is a `playwright install-deps` step in the job.
- A run interrupted by a signal stops the server but leaves its empty temp persist directory for
  the OS to clean up.
- Doctor checks that the browser tests run, not that a feature added one. The checklist line has
  no gate of its own.
- Lite projects pay a skip message per push for a gate they do not have.

## Verification

- `bun test cli/e2e.core.test.ts`: which files count as tests and the commands `axioms e2e` runs.
- `bun test cli/doctor.core.test.ts`: the missing CI `e2e` step, a harness pre-push without the
  job, a skipped or echoed job, and a project `lefthook.yml` that skips or redefines it. The
  healthy fixture reads the shipped `harness/lefthook.yml`, so the test also pins that the hook
  runs `axioms e2e`.
- `bun test tests/rules.test.ts`: `apps/web/e2e/*.e2e.ts` may use `process` and `Bun`;
  `apps/web/src/e2e/` may not.
- `bun run selftest`: `axioms e2e` passes on a fresh project, and fails with a failing test; in
  both runs no process from the command's tree is left running. Doctor fails when `ci.yml` drops
  the `e2e` step and when `lefthook.yml` skips the pre-push `e2e` job. `axioms ci-dry-run --all`
  replays the `e2e` job on a clean clone.
