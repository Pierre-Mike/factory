# Agent Note: The harness repo is public under Apache-2.0

Status: implemented

## Problem

The owner wants to share the factory: people should be able to read it, generate a project with
it, and reuse the ideas. Since v0.10.0 that has been impossible for anyone else. `LICENSE`
reserved all rights, and every generated or adopted project installed the harness through a
`git+ssh` spec plus a `harness-access` CI step that fails without a `HARNESS_TOKEN` secret. An
outside user has neither an SSH key for the repo nor a token, so `bun install` and every CI job
fail for them.

This reverses [the private-repo decision](../../archived/process/2026-10-15-private-harness-repo.md).

## Decision

The repo is public. `LICENSE` is the verbatim Apache License 2.0 text, `NOTICE` carries the
copyright line, and `package.json` says `"license": "Apache-2.0"`. It keeps `"private": true`,
because the harness ships through git tags, never npm, and the flag blocks an accidental
`npm publish`.

- `releaseSpec` in `cli/new.core.ts` returns `github:Pierre-Mike/factory#vX.Y.Z` again. Bun
  fetches a public tag's tarball with no credentials, locally and in CI.
- The `harness-access` step is gone from the template's `ci.yml` and from the workflow
  `axioms adopt` stamps (`liteCiWorkflow` in `cli/adopt.core.ts`). `axioms new` no longer prints
  the `gh secret set HARNESS_TOKEN` step.
- `axioms doctor` flags the two leftovers of v0.10.0 and v0.11.0: a `git+ssh` harness spec, with
  the `github:` spec as the remedy, and any CI job that still has the `id: harness-access` step.
  `HARNESS_ACCESS_ID` stays in `cli/doctor.core.ts` for that check.
- `axioms ci-dry-run` no longer stands in for `harness-access`. A project that still has the step
  gets the doctor finding first.

## Alternatives considered

**Stay private and share read access with named people.** It keeps the token and SSH setup for
every one of them, and nobody can reuse the code without a license grant.

**Go public but keep the `git+ssh` spec and the access step.** The owner's projects would keep
working with no change, but an outside user's first `bun install` fails without an SSH key, and
their CI fails until they create a token for a repo that no longer needs one.

**MIT, as before v0.10.0.** The owner chose Apache-2.0 for its explicit patent grant.

## Consequences

- Projects on v0.10.0 or v0.11.0 keep installing as long as the owner's `insteadOf` rewrite and
  their `HARNESS_TOKEN` secret stay in place. Moving one to v0.12.0 means pinning the `github:`
  spec, deleting the `harness-access` step from each job (doctor names them), and deleting the
  secret.
- Fork PRs to a generated project can install the harness again, since no secret is involved.
- The v0.10.0 and v0.11.0 tags still carry the all-rights-reserved `LICENSE`. Those versions are
  readable once the repo is public, but the Apache grant starts at v0.12.0.

## Verification

- `bun run verify`: lint, typecheck, unit tests and the notes gate pass, including the doctor
  tests for the `git+ssh` spec and the leftover `harness-access` step.
- `bun run selftest` and `bun run selftest:adopt` pass. The CI dry run replays the template's
  `ci.yml`, now with no access step, on a clean clone.
- Not yet run: `bun add -d github:Pierre-Mike/factory#v0.12.0` in a scratch directory with no
  GitHub credentials. It can only pass after the repo is public and the tag is pushed.
