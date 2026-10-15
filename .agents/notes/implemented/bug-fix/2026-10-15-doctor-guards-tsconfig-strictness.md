# Agent Note: doctor guards tsconfig strictness

Status: implemented

## Problem

The harness blocks every per-line or per-config way to switch off a lint or type gate except one.
Suppression comments fail the `suppressions` gate, and `axioms doctor` rejects a `biome.json` that
adds rules, extends something else or narrows its files. Nothing looked at the tsconfig chain. An
agent facing a type error from `noUncheckedIndexedAccess` or `strict` could set that option to
`false` in a workspace `tsconfig.json`, or drop the `extends` from `tsconfig.base.json`, and
`tsc -b`, `axioms check` and CI would all pass. It is the quickest way to make a type error go away,
so agents reach for it.

## Decision

`axioms doctor` reads `tsconfig.base.json` and the `tsconfig.json` of every workspace, parsing them
as JSONC with `ts.parseConfigFileTextToJson` (the template's server tsconfig has a comment). It
reports a `typecheck` finding when:

- `tsconfig.base.json` does not extend `@pierre-mike/axioms/tsconfig`;
- a workspace tsconfig extends neither the root `tsconfig.base.json` (resolved from its own folder)
  nor the harness tsconfig directly;
- any of these files sets a strict check to `false`: `strict` and its sub-flags (`noImplicitAny`,
  `strictNullChecks` and the rest), `noUncheckedIndexedAccess`, `noImplicitOverride` or
  `noFallthroughCasesInSwitch`;
- a file is missing or not valid JSONC.

The logic is `checkTsconfigs` in `cli/doctor.core.ts`; `cli/commands/doctor.ts` reads the files.
The canon's doctor bullet names the check.

## Alternatives considered

**Compare every compiler option to the harness value.** Workspaces legitimately set `lib`,
`types`, `outDir` and `rootDir`, so this would flag correct configs or need an allowlist that
drifts. Only setting a strict check to `false` loosens the type checker, so only that is flagged.

**Also reject `exclude` in workspace tsconfigs.** Excluding a file hides it from `tsc` the way
narrowing `files.includes` hides it from Biome. It was left out because a legitimate `exclude` is
possible and no case of misuse has been seen; revisit if one shows up.

## Consequences

- A project that already turned a strict check off fails `check` after upgrading, until it removes
  the override and fixes the errors behind it. That is the intent.
- Setting a strict flag to `true` explicitly, or adding unrelated options, stays allowed.
- Strictness can still be loosened through a tsconfig that is not a workspace root (one that `tsc`
  only reaches through `references` outside the workspace list). The template has none.

## Verification

- `bun run verify`: lint, typecheck, 159 tests including the `tsconfig strictness` cases in
  `cli/doctor.core.test.ts`, and the notes gate.
- `axioms doctor` on a copy of the template with `"strict": false` in `shared/tsconfig.json`
  reports `shared/tsconfig.json turns off strict`; on an existing project (vinted-closet) it reports
  no `typecheck` finding.
