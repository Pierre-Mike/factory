# Agent Note: A deploy workflow in the template, with a push or manual mode

Status: implemented

## Problem

The template's ci.yml runs `axioms deploy --dry-run` on every PR, but no workflow ever runs a real
`axioms deploy`. Each project wrote its own deploy workflow by hand (small-tools did, in
Pierre-Mike/small-tools#3), and `axioms doctor` did not look for one. A project could delete or
break its deploy and every gate still passed. Some projects also want to deploy only when someone
asks, not on every merge.

## Decision

The template ships `.github/workflows/deploy.yml`, and doctor requires it in app projects.

- The workflow runs `bunx axioms deploy` in a `deploy` job. Only that step gets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, from secrets. The job runs in the
  `production` environment, with `concurrency: deploy-production` and `cancel-in-progress: false`
  so deploys run one at a time and none stops halfway. Actions are pinned to commit SHAs and
  checkout sets `persist-credentials: false`, so actionlint and zizmor report nothing.
- It stays out of ci.yml because `axioms ci-dry-run` replays every ci.yml job, and a replay must
  never deploy.
- The deploy mode is a project setting in package.json, next to `profile`:
  `"axioms": { "deploy": "manual" }` makes deploy.yml run only on `workflow_dispatch`. Without it
  the mode is `push`, the default: a push to main deploys, and `workflow_dispatch` is there too.
  `axioms new --deploy push|manual` writes the setting (nothing for push) and the matching
  deploy.yml. `renderDeployWorkflow` in `cli/new.core.ts` produces the manual variant by removing
  the template's `push:` trigger, so both modes come from one template file.
- `axioms sync` adds deploy.yml to an app project that has none, for the mode package.json
  declares. It leaves an existing deploy.yml alone, the way it leaves ci.yml alone: the file may
  carry a project's own environment url.
- `checkDeploy` in `cli/doctor.core.ts` fails (rule `deploy`) when deploy.yml is missing or not
  valid YAML; when no job runs `axioms deploy` as a step without `if:` or `continue-on-error:`, on
  the step or on its job (the same `runsGate` and `optional` rules as the ci.yml gates, so
  `deploy --dry-run` does not count); and when the trigger does not match the declared mode: a push
  project with no push trigger, a manual project that deploys on push, or a manual project with no
  `workflow_dispatch`. Doctor accepts both modes. A lite (`axioms adopt`) project has no worker and
  is not asked for deploy.yml.
- To switch an existing project, set or remove `"deploy": "manual"` in package.json and edit `on:`
  in deploy.yml (or delete it and run `bunx axioms sync`). Doctor names both edits until they agree.
- The template leaves out `environment.url`. The workers.dev address depends on each Cloudflare
  account's subdomain, which the harness cannot know without calling Cloudflare. A comment in the
  job says where to add it.

## Alternatives considered

**An `axioms deploy-mode <push|manual>` command.** It would rewrite the trigger for you, but adds
a command that edits YAML text in place. The package.json setting is how the CLI already stores
`profile`, and doctor's message says what to change.

**Sync rewrites deploy.yml on every run, like biome.json.** That would keep every project's file
identical, but it would delete a project's `environment.url` and any other step it added. Doctor
already checks the parts that matter.

**Doctor accepts either trigger and the mode is only read at generation time.** Simpler, but then
nothing records whether a project meant to deploy on push. A manual project that gained a push
trigger would deploy on the next merge with every gate green.

**Fill `environment.url` from `wrangler whoami` or the Cloudflare API during sync.** It needs a
Cloudflare login at sync time, which CI and fresh machines do not have. The url only labels the
deployment in GitHub's UI.

**Put the deploy job in ci.yml behind `if: github.event_name == 'push'`.** `ci-dry-run` would
replay it, and the doctor would have to tell a deploy that may be skipped from one that must run.

## Consequences

- Every new app project deploys on its first push to main, and fails there until the two secrets
  exist. `axioms new` prints the `gh secret set` commands, and the doctor warns about missing
  secrets (see [the deploy secrets note](2026-10-20-deploy-secrets-warning.md)).
- Projects created before this release fail doctor with "deploy.yml is missing" after upgrading;
  `bunx axioms sync` fixes it. small-tools already has a deploy.yml that passes.
- Doctor reads one more file and the selftest generates a second project (`--deploy manual
  --no-install`), which adds a few seconds.
- The trigger check looks at event names only. A push trigger limited to a branch other than main
  still counts as push.

## Verification

- `cli/doctor.core.test.ts` "deploy.yml": the template passes; missing and invalid YAML; a step
  that runs `deploy --dry-run` or `wrangler deploy`; `if:` on the step and on the job;
  `continue-on-error` on the step and on the job; both modes with matching and mismatched
  triggers; a manual workflow with no `workflow_dispatch`; a lite project. `renderDeployWorkflow`
  and `cli/new.core.test.ts` cover the manual variant, `--deploy` parsing, and the package.json
  setting.
- `bun run selftest`: `axioms new` ships deploy.yml and `check` passes; doctor fails after the
  file is deleted and `sync` restores it byte for byte (`git diff --exit-code`); `ci-dry-run --all`
  runs `lint-workflows` over it; a second project from `new --deploy manual` passes `doctor` and
  `lint-workflows`.
- `actionlint` and `zizmor --offline` on `template/.github/workflows/deploy.yml`: no findings
  (zizmor's auditor persona adds one informational "job has no name", which ci.yml's jobs share).
