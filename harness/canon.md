## Architecture: feature-first vertical slices

Code is organized by feature, not by layer. Each slice owns its full vertical:

```
apps/server/
  src/
    features/<feature>/
      <feature>.core.ts        # pure domain logic: no I/O, no Effect runtime
      <feature>.core.test.ts   # co-located unit test (data in, data out)
      <feature>.io.ts          # I/O as an Effect service (Context.Service + Layer)
      <feature>.routes.ts      # Hono shell: impure read, pure core, respond
      <feature>.routes.test.ts # the route over an in-memory SQLite database
      <feature>.door.ts        # opt-in: the only file other slices may import
    platform/                  # runtime, typed config, HTTP errors, the SQL port
    api.ts                     # mounts every slice under /api, exports AppType
    worker.ts                  # composition root (Cloudflare Workers entry)
  migrations/                  # D1 migrations; tests run against the same files
  smoke/                       # HTTP checks against a running `wrangler dev`
apps/web/                      # Vite + React + TanStack Router + Query, served as Worker assets
shared/                        # effect Schema contracts used by server and web
```

## The impureim sandwich

- `*.core.ts` is pure. Failures are values: `Result`, `Option`, or `Data` tagged unions. No
  `Effect`, `Layer`, `Context`, async, I/O or clock. `Result`, `Option`, `Data` and `Schema` from
  `effect` are allowed. (Effect 4 renamed v3's `Either` to `Result`: `Result.succeed`,
  `Result.fail`, `Result.isFailure`.)
- `*.io.ts` and `*.routes.ts` use Effect. Services are `Context.Service`s, wiring is `Layer`s, and
  the runtime is a `ManagedRuntime` built in `platform/runtime.ts`.
- A route reads through the io service, calls the pure core, and responds. The core's `Result` is
  lifted at the boundary with `yield* Effect.fromResult(core(...))`, so a failure short-circuits as
  a typed error. A bare `yield* core(...)` does not typecheck in Effect 4, so `tsc` catches a
  missing lift.

## Rules (each one is enforced by a tool)

- In `*.core.ts`, Biome bans named imports of `Effect`/`Layer`/`Context` from `effect` and imports
  of their subpaths (`effect/Effect`), `*.io` and `*.door` imports, `Date`, `performance`,
  `crypto` (the global and the `node:crypto` import), `Promise`, `console` and timers. Grit
  plugins ban `throw`, the throwing `Schema.decodeSync`/`decodeUnknownSync` (use
  `decodeUnknownResult`), `await` and `Math.random()` there.
- No `biome-ignore`, `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck` outside tests. The
  `suppressions` gate of `axioms check` fails on them. Fix the code, or change the rule in the
  harness.
- Functions you declare take at most one parameter. Pass an options object for more.
- No raw `fetch` and no `axios`. The web app calls the server through `hc<AppType>`. Only
  `*.io.ts` may call `fetch`, for external services.
- The app runs on Cloudflare Workers. `process` (the global and the `node:process` import) and
  `Bun` are banned in app code. Bun APIs are allowed only in `*.bun.ts` adapters, tests and
  tooling. Tooling means `scripts/`, `smoke/` and
  `*.config.ts` outside `src/`: anything under `src/` ships, whatever its name.
- A Grit plugin bans reaching any of these banned globals (`fetch`, `process`, `Bun`, and the core
  bans such as `Date` and `crypto`) through `globalThis`, `self` or `window`. Use the bare name, so
  the rules for the file's shape apply.
- Every `*.core.ts` has a sibling `*.core.test.ts`. Use fast-check for non-trivial pure logic.
- Configuration is decoded once from the Worker env in `platform/config.ts` with a Schema.
- Database rows are `unknown` until decoded with a Schema in the slice's `*.io.ts`.
- Failures cross HTTP as the shared `ApiErrorBody` envelope. `STATUS_BY_TAG` in
  `platform/http.ts` is an allowlist. An unregistered tag returns a redacted 500 and is logged.
- Shared Schema contracts live in `shared/src`. The web client decodes every response with them,
  and excess fields are rejected.
- Define `queryOptions` once. The route loader calls `ensureQueryData`, the component calls
  `useSuspenseQuery` on the same options.
- A slice may import another slice's `<feature>.door.ts` only, never its other files.
- Commits follow `type(scope)?: subject`, with a first line of at most 150 characters. Say what
  changed and why; put the rest in the body. The commit-msg hook rejects anything else.
- A change to CI/CD is dry-run before it leaves the machine. When a push touches workflows,
  `package.json`, `bun.lock`, `wrangler.jsonc`, migrations or other build config, the pre-push hook
  runs `axioms ci-dry-run`: actionlint and zizmor on the workflows, then every job of `ci.yml`
  replayed in a fresh clone of HEAD outside the project folder. A step it cannot reproduce fails
  the dry run. Run it by hand with `bun run ci:dry`.
- Every PR runs `axioms deploy --dry-run` (the worker bundled exactly as `wrangler deploy` would,
  every migration applied to a fresh D1) and `axioms lint-workflows`. A real `axioms deploy`
  refuses while placeholders remain in `wrangler.jsonc`.
- No secret leaves the machine. The pre-commit hook runs gitleaks on the staged changes
  (`axioms secret-scan --staged`), and the `secret-scan` job on every PR scans the committed
  history. A missing gitleaks fails the gate instead of skipping it (`brew install gitleaks`); a
  false positive is silenced by fingerprint in `.gitleaksignore`, never by removing the hook.
- A PR is opened with its body built from `.github/PULL_REQUEST_TEMPLATE.md`: what changed, why,
  the verification commands run, and the owning Agent Note. `gh pr create` does not auto-fill
  templates, so construct the body from the file. The `axioms pr-body` gate in CI fails a PR whose
  body is missing a section or leaves one empty, and `axioms doctor` fails a ci.yml that drops
  the gate.
- The harness is pinned to a released tag (`github:Pierre-Mike/factory#vX.Y.Z`), never a local
  path, because a CI runner cannot install a path that only exists on one machine.
- `axioms doctor` fails when a part of this harness is missing or unwired, when `biome.json` adds
  rules, extends anything besides the harness or narrows `files.includes`, when a nested Biome
  config exists, when a CI gate is missing, skippable or allowed to fail, and when a tsconfig
  stops extending the harness or sets a strict check (`strict`, `noUncheckedIndexedAccess` and
  the rest) to `false`. Fix the type error instead.
- Branch protection is a file the harness owns: `harness/github.rules.json` requires a pull
  request with one approving review before merge (so no direct pushes), the ci.yml jobs as
  required status checks, linear history, and blocks force pushes and deletion of the default
  branch; repository auto-merge stays on. `bunx axioms rules --apply` writes it to GitHub through
  `gh api`, and `axioms doctor` fails while the live rules or the auto-merge setting drift from
  the file. When doctor cannot read the rules (no GitHub remote yet, gh missing or not
  authenticated, or a private repo on a plan without rulesets), it reports what it could not
  verify and why instead of failing.

## Decisions: Agent Notes

Sessions do not share memory. A decision lasts only if it is written down, so every agent that
works here reads and keeps the Agent Notes in
`.agents/notes/{proposed,implemented,rejected,archived}/{class}/yyyy-mm-dd-topic.md`. The full
rules, including archiving, are in `.agents/notes/README.md`.

**Before you change anything**

1. List `.agents/notes/implemented/` and `.agents/notes/proposed/`, and read every note whose topic
   touches the area you are about to change. An implemented note is the current decision: follow
   it, or supersede it with a new note. A proposed note is work not yet built. A rejected note says
   why an idea was turned down. `archived/` is history, not authority.
2. Find the owner. If a note already covers the decision, update that note. Never write a second
   note for the same decision.

**When you decide something**

- A lasting decision gets a note in the same commit: new user-visible behavior, a contract shared
  across files (a `shared/src` schema, an error tag, a route shape), storage or a migration
  strategy, architecture, tooling or process, test strategy, a non-local bug fix, or any choice a
  maintainer may revisit. Typos, formatting, local UI tweaks and mechanical edits need none.
- Work not built yet starts in `proposed/<class>/` with `## Problem`, `## Proposal`,
  `## Alternatives considered`, `## Acceptance criteria` and `## Risks`. Each acceptance criterion
  names the check that could prove it false: a `*.core.test.ts`, a `*.routes.test.ts`, a smoke
  test, or a command such as `bun run deploy:dry`.
- A decision made and shipped in this change goes straight to `implemented/<class>/` with
  `## Problem`, `## Decision`, `## Alternatives considered`, `## Consequences` and optionally
  `## Verification`, in the present tense.
- Every note starts `# Agent Note: <title>`, a blank line, `Status: <lifecycle>`, a blank line.
  Classes: `feature`, `bug-fix`, `simplification`, `architecture`, `process`, `testing`. The date
  in the filename is the day the topic was first proposed and never changes.
- Record real alternatives only. If there were none, say so in the section.

**When it ships, or changes**

- Promote by rewriting: `git mv` the note to `implemented/`, set `Status: implemented`, turn
  `## Proposal` into a present-tense `## Decision`, fold acceptance criteria and risks into
  `## Consequences` and `## Verification` with the commands you ran. Changing only the status word
  is not a promotion.
- A declined proposal moves to `rejected/` with `Status: rejected — <reason>`.
- When code moves a file, renames a module or changes a default an implemented note names, fix
  the note in the same commit. Reversing a shipped decision takes a new note, linked both ways.
- When you finish, say which note owns the change and whether you created, updated or promoted it.

`axioms notes` fails on an unknown folder or class, a bad filename, a `Status:` line that
disagrees with the folder, a missing required section, a proposal heading left in an implemented
note, a broken link into a notes tree, or an edited archived note. `axioms check`, the pre-commit
hook and CI run it, and `axioms doctor` fails when `.agents/notes/README.md` differs from the
harness. Fix the note, never the gate, and never copy a second notes gate into the project.

## How to add a feature slice

1. `bun run slice <feature>` generates the files, mounts the route in `api.ts`, registers the
   Layer in `platform/runtime.ts` and the error tag in `platform/http.ts`. Never hand-copy a slice.
2. Add a migration in `apps/server/migrations/` if the slice stores data.
3. Write the pure logic in `<feature>.core.ts` and its test.
4. Replace the stub I/O in `<feature>.io.ts`.
5. Register new error tags in `platform/http.ts`.
6. Put contracts the web uses in `shared/src`.
7. (web) Add `<feature>.queries.ts` and `<feature>.route.tsx`.
8. Add a `smoke/<feature>.smoke.test.ts` that exercises the slice over real HTTP.
9. `bun run check`, then `bun run smoke`.

## Commands

```bash
bun install        # installs dependencies and git hooks
bun run dev        # wrangler dev (API, :8787) + vite (web, :5173)
bun run check      # lint, typecheck, co-location, suppressions, notes, doctor, tests, dead code, duplication
bun run smoke      # build the web app, start wrangler dev locally, run smoke/ over HTTP
bun run slice      # generate a feature slice
bun run deploy:dry # bundle the worker and apply migrations locally, no Cloudflare account needed
bun run ci:dry     # replay ci.yml on a clean clone (pre-push does this for CI/CD changes)
bun run deploy     # refuse on placeholders, dry-run, apply D1 migrations remotely, wrangler deploy
bunx axioms notes  # check .agents/notes (--seal after archiving a note)
bunx axioms pr-body draft.md  # check a drafted PR body fills the PR template (CI checks the real one)
bunx axioms rules --apply # create or update the GitHub branch ruleset from the harness (needs gh)
bunx axioms sync   # rewrite this section, the note rules and the hook config from the harness
```
