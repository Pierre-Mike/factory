# Agent Note: Doctor warns when the deploy secrets are missing

Status: implemented

## Problem

Nothing checked that the secrets the deploy workflow needs exist on GitHub. A merge to main could
start a deploy that fails on authentication, and the failure showed up only after the merge. On
small-tools (Pierre-Mike/small-tools#3), `CLOUDFLARE_API_TOKEN` was believed to be set and was
not. Someone caught it by running `gh secret list` by hand before merging.

## Decision

`axioms doctor` checks the deploy secrets by name and warns when one is missing. A warning never
fails the doctor.

- The names come from deploy.yml, not from a list in the code: `deploySecretNames` collects every
  `${{ secrets.NAME }}` the workflow reads, except `GITHUB_TOKEN`, which Actions provides.
  `deployEnvironments` collects the environments its jobs run in (`environment: x` or
  `environment: { name: x }`; a name built from an expression is skipped). Both are pure, in
  `cli/doctor.core.ts`.
- `readSecretsState` in `cli/commands/github.ts` runs `gh secret list --json name` for the repo
  and `gh secret list --env <name> --json name` for each environment. It reads names only; GitHub
  never returns values. An environment that answers HTTP 404 does not exist yet (GitHub creates it
  on the first job that names it) and counts as having no secrets. When deploy.yml names no secret,
  doctor makes no `gh` call.
- `checkDeploySecrets` returns warnings and "not verified" lines, not findings. A secret is present
  when the repository or any of those environments has it. Each missing one becomes a warning with
  rule `secrets`, naming the secret and the fix: `gh secret set CLOUDFLARE_API_TOKEN`.
- When the names cannot be read (gh missing, no GitHub remote, gh not authenticated, no permission
  to list secrets), doctor prints `– [secrets] CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID not
  verified: <reason>`, the same shape as the branch-protection check's
  `– [github] branch protection not verified: <reason>`. The reason passes through from gh.
- `axioms doctor --json` prints one JSON document on stdout: `pass`, `failures`, `warnings` and
  `unverified`. `pass` depends on `failures` only (`doctorReport`). The text output prints the
  "not verified" lines and the warnings (`⚠ [secrets] ...`) before the verdict, which stays
  "every harness gate is present and wired" when only warnings remain. Inside `axioms check` the
  doctor gate passes and its output carries the warnings.

## Alternatives considered

**Fail the doctor when a secret is missing.** A new project has no secrets until its first deploy,
and the doctor runs in `axioms check`, the pre-commit hook and CI. Every new project would start
red, and CI runs, where `gh` usually cannot list secrets, would fail for a reason they cannot fix.

**Hard-code `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.** Simpler, but a project that adds
a secret to its deploy step, or renames one, would be checked against the wrong list.

**Read secrets from only the steps that run `axioms deploy`.** More precise, but any secret
deploy.yml reads has to exist for the workflow to work, so the whole file is the right scope.

**Treat a 404 environment as "not verified".** Every project before its first deploy has no
`production` environment, so the check would never report anything useful until after the deploy
it is meant to protect.

## Consequences

- Doctor spawns `gh` more often: `repo view` again, the repository list, and one list per
  environment, three calls for the template. It does so only when deploy.yml names a secret.
- In CI, `gh` is usually unauthenticated or lacks the permission to list secrets, so CI prints the
  "not verified" line. The check helps on the developer's machine, before the merge.
- A secret set at organization level is not seen: `gh secret list` without `--org` lists repository
  secrets only. A project that relies on an org secret gets a warning it can ignore.
- `axioms doctor` now accepts `--json` and refuses any other argument, as `axioms rules` does.

## Verification

- `cli/doctor.core.test.ts` "deploy secrets": names and environments read from the template's
  deploy.yml; both secrets present (one at repository level, one in `production`); one missing;
  both missing; unreadable. Each case runs `doctorReport` over a healthy project and asserts
  `pass: true` with the matching warnings or "not verified" line. A failure still fails the report.
  "parseDoctorArgs" covers `--json` and an unknown flag.
- `bun run selftest`: on the generated project, which has no GitHub remote, `axioms doctor --json`
  exits 0 with `"pass": true` and "CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID not verified".
- Live, read-only, against Pierre-Mike/factory (no Cloudflare secrets, no `production`
  environment): `readSecretsState` returned the repository list as empty and `production` as not
  existing, and `checkDeploySecrets` produced the two warnings with `gh secret set` remedies.
