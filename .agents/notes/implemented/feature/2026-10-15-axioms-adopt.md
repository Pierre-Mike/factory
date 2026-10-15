# Agent Note: axioms adopt brings the lite harness to existing repos

Status: implemented

## Problem

The harness only reaches projects born from the template: `axioms new` stamps a Cloudflare app and
wires every gate into it. A repository that already exists — a script collection, a library, a
non-Workers service — can get none of it without copying configs by hand, which is exactly the
drift the factory replaced. Every repo should be able to get the gates, not just factory-born apps.

## Decision

`axioms adopt [--harness <spec>] [--no-install]`, run at the root of an existing git repository,
installs the lite harness and nothing app-shaped.

- Adopt stamps only the skeleton and delegates every synced copy to `axioms sync`, which it calls
  twice: once before `bun install` so the files exist even with `--no-install`, once after it so
  sync's own formatting and `lefthook install` run with the harness in node_modules. Adopt never
  duplicates what sync writes.
- The skeleton is: `package.json` with `@pierre-mike/axioms` pinned to the release tag of the
  running version (the same rules as `new`, including the `--harness file:<path>` plus
  `AXIOMS_ALLOW_LOCAL_HARNESS=1` escape hatch the selftests use), a forced `check` script, `lint`
  and `prepare` scripts when absent, `"axioms": { "profile": "lite" }`, a one-job
  `.github/workflows/ci.yml` running `bunx axioms check` on the repo's default branch with the
  same pinned action SHAs as the template, a `.fallowrc.json` with guessed entry points, and the
  missing `.gitignore` entries (`node_modules`, `dist`, `*.tsbuildinfo`, `.DS_Store`). An existing
  ci.yml or .fallowrc.json is left alone, with a warning saying what doctor expects.
- The decisions are pure in `cli/adopt.core.ts` (`parseAdoptArgs`, `planAdopt`) with a co-located
  test; `cli/commands/adopt.ts` reads the files, writes the plan and runs the processes.
- `harnessProfile` in `cli/doctor.core.ts` reads the recorded profile; absent means `app`, so
  template projects are untouched and losing the marker makes the doctor stricter, never quieter.
  In the `lite` profile the doctor keeps the checks for the gates adopt installs — Biome, hooks,
  agent docs, notes rules, the `.claude/` settings and skills copies sync writes, the pinned
  package (`check` script only, no `smoke`), a must-pass `bunx axioms check` CI step and pinned
  action SHAs — and skips the app-shaped ones: workspace references, the tsconfig chain, smoke
  coverage, the error-tag allowlist and the Effect major.
- In a repo with no `biome.json` or tsconfig, adopt installs nothing extra: sync writes
  `biome.json` as it does everywhere, and adopt never writes a tsconfig. `axioms check` skips the
  typecheck gate when the root has no `tsconfig.json` and the `bun test` gate when no test file
  matches Bun's own discovery pattern. A skip is said, never silent: the gate returns
  `{ skipped: reason }` (`GateVerdict` in `cli/commands/gates.ts`), the runner prints
  `– typecheck skipped: no tsconfig.json at the project root`, and the `--json` / `--report`
  evidence lists the gate with `"pass": true` and `"skipped": "<reason>"`, counted in the report's
  `skipped` total. A repo that adds a `tsconfig.json` gets the gate back on the next run. Every
  other gate (lint, co-location, suppressions, notes, doctor, dead code, duplication) runs
  unchanged.
- Refusals are clean and change nothing: not at a git repository root; a `package.json` that does
  not parse; the factory itself; and a repo that already depends on the harness, which is pointed
  to `bunx axioms sync`. That refusal is what makes adopting twice safe.

## Alternatives considered

**Detect the profile from the file layout** (`apps/server` or `wrangler.jsonc` present means app).
Deleting an app folder would silently reclassify the project as lite and drop its gates — exactly
the drift doctor exists to catch. The recorded `"axioms": { "profile": "lite" }` key is explicit,
greppable and fails loud when lost.

**Install the shared tsconfig when TypeScript is detected.** The harness tsconfig sets
`composite`, `declaration` and `strict`; dropping it onto an arbitrary codebase emits build output
and typically fails with hundreds of errors on first check, so adopt would hand out a red repo and
an implicit migration. Skipping typecheck with a printed message is the simplest honest behavior;
the repo opts in by adding its own tsconfig.

**Teach `axioms new` an in-place mode.** `new` is built around stamping a template into an empty
folder (name substitution, first commit, wrangler); in-place semantics share almost none of it
beyond the pinning rule, which adopt reuses from `new.core`.

**Reuse the template's ci.yml and strip the app jobs at runtime.** Parsing and re-serializing YAML
loses comments and formatting; the lite workflow is a constant in `adopt.core.ts` instead, with
the action SHAs kept in step with `template/.github/workflows/ci.yml` by hand.

## Consequences

- An adopted repo gets lint, hooks, agent docs, Agent Notes, the shared Claude Code settings and
  skills, doctor, dead-code and duplication gates, and CI, with no wrangler anywhere. It gives up nothing it had: existing scripts other
  than `check` are kept, and a `prepare` script that lacks `axioms hooks` only earns a warning.
- The gates run through bun (`bunx axioms …`), whatever package manager the repo used before, and
  `bun install` adds a `bun.lock` the stamped CI consumes with `--frozen-lockfile`.
- Existing code now faces the harness rules, so the first `bun run check` may be red; that is the
  adoption, not a bug. `.fallowrc.json` entry points are guesses the owner refines.
- The action SHAs exist in two places (template ci.yml and `adopt.core.ts`); bumping one without
  the other drifts silently until the next hand check. Accepted for now: doctor still requires a
  40-character pin, whichever SHA it is.
- `check`'s typecheck and test gates are existence-conditioned everywhere, not only in lite repos.
  App projects always have both, and in the `app` profile doctor still fails when
  `tsconfig.base.json` goes missing, so nothing app-shaped can skip silently.
- A project could hand-write the lite profile key to shed app checks; the diff and the key are
  visible, and the canon already treats weakening the gates as the thing to review.

## Verification

- `bun run verify`: lint, typecheck, the `adopt.core.test.ts` cases (argument parsing, refusals,
  package.json planning, skeleton files) and the `lite profile` cases in `doctor.core.test.ts`,
  then the notes gate.
- `bun run selftest:adopt` (also a factory CI job): on a throwaway plain git repository with
  TypeScript files, no package.json and no tsconfig, adopt refuses outside a git repo, adopts,
  refuses a second run pointing to sync, the installed commit-msg hook rejects a free-form
  message, `axioms sync` right after adopt changes nothing, `axioms check --report` passes with
  "typecheck skipped: no tsconfig.json" and the lite doctor while its report lists typecheck as
  skipped with that reason and the test gate as run, and the notes gate rejects a
  status-word-only promotion then accepts the rewritten note.
