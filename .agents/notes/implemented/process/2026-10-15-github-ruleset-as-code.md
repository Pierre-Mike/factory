# Agent Note: GitHub branch protection as code

Status: implemented

## Problem

Every gate the factory ships runs locally and in CI, but nothing stops a push from skipping them:
branch protection lives in GitHub's settings UI, is configured by hand per repository, and no tool
notices when it is missing or weakened. A project can pass `axioms check` forever while its `main`
accepts direct pushes, force pushes and merges with no review or green CI. The repo's own canon
says a rule with no enforcement does not go in, and branch protection had no enforcement.

## Decision

Branch protection is a file the harness owns, and a missing rule is a failing doctor gate.

- `harness/github.rules.json` is a GitHub repository ruleset (the shape `POST
  /repos/{owner}/{repo}/rulesets` accepts, same as the UI's import/export) for the default branch:
  pull requests with one approving review before merge, which also blocks direct pushes, the six
  `template/.github/workflows/ci.yml` jobs (`check`, `smoke`, `deploy-dry-run`, `pr-body`,
  `workflow-lint`, `secret-scan`) as required status checks, linear history, no force pushes
  (`non_fast_forward`), no deletion, merge by squash or rebase only, no bypass actors. Repository
  auto-merge on is part of the expected state, so a green, approved PR merges without a human
  pressing the button; it is a repo setting, not a ruleset rule, so it lives in the check rather
  than the file.
- `axioms rules --apply` converges a repo on the file through `gh api`: it matches live rulesets by
  name (`PUT` the existing id, else `POST`) so reruns update in place, then `PATCH`es
  `allow_auto_merge` on when it is off. Without `--apply` it prints the calls it would make.
  `cli/commands/rules.ts` is the shell; the call planning is pure in `planRulesetApply`.
- `axioms doctor` diffs the live state against the file with the pure `checkGithubRules`
  (`cli/rules.core.ts`): expected JSON and actual JSON in, findings out, in doctor's existing
  finding shape with rule `github` and the remedy `bunx axioms rules --apply`. The shell
  (`cli/commands/github.ts`) reads the live state read-only: `gh repo view` for owner/name, `GET
  repos/{owner}/{repo}` for `allow_auto_merge` and the default branch, and `GET
  repos/{owner}/{repo}/rules/branches/{branch}` for the rules active on that branch. The branch
  endpoint aggregates repo and org rulesets and already excludes disabled ones, so a ruleset that
  exists but does not protect the branch still fails.
- When the state cannot be read there is nothing to judge, so doctor reports instead of failing:
  `githubNotice` prints `– [github] branch protection not verified: <reason>` before the summary.
  Reasons pass through from the shell: gh not installed, no GitHub remote (every fresh
  `axioms new` project until it is pushed), gh not authenticated, or GitHub refusing the rulesets
  API, which it does with HTTP 403 on private repos under the Free plan. A repo whose rules gh can
  read and that is missing one fails: an unprotected branch returns `200 []`, which yields one
  finding per expected rule.
- A default branch that is not on GitHub yet is also "not verified". A new repo names `main` as
  its default before anything is pushed, and its branch rules read as `200 []`, so the pre-push
  hook failed the very push that would create `main`. The shell now asks `GET
  repos/{owner}/{repo}/branches/{default}` first, and the pure `branchLookupFailure` turns its
  HTTP 404 into the reason "main is not on <repo> yet: push it, then run `bunx axioms rules
  --apply`". `axioms new` prints that order: `gh repo create --push`, then `rules --apply`.
- Agent PRs come from a bot account so the owner can approve them. GitHub never lets a PR's
  author approve it, so with one required review and no bypass actors, a PR an agent opens under
  the owner's own login can never merge. The pull-request skill runs `gh pr create` with
  `GH_TOKEN="${AXIOMS_BOT_TOKEN:-$(gh auth token)}"`. `AXIOMS_BOT_TOKEN` is a classic token with
  `public_repo` (or `repo`) scope for a second GitHub account, a machine user added to the project
  as a collaborator with write access. A fine-grained token cannot be used here: it only reaches
  repos its own account or organization owns. Without the variable the PR opens as the owner, and
  the skill says that it cannot merge until someone else approves.

## Alternatives considered

**Classic branch protection (`PUT /repos/{o}/{r}/branches/{branch}/protection`).** The older
mechanism, superseded by rulesets: per-branch instead of pattern-based, no JSON import/export in
the UI, no org-level aggregation. Rulesets are what GitHub evolves.

**Diff ruleset documents (`GET rulesets` then `GET rulesets/{id}` each).** Needs N+1 calls, misses
org-level rulesets that may already protect the branch, and counts a disabled ruleset as present.
The branch rules endpoint answers the real question (what is enforced on this branch, right now)
in one call.

**Deep structural equality between the file and the live JSON.** Brittle: the API decorates
responses with ids, sources and defaults, so an exact diff fails on noise and every API addition.
The check asserts the invariants the factory cares about instead: each expected rule type active,
review count at least the file's, every expected context required, auto-merge on. A stricter live
setting (two reviews) passes.

**Fail doctor when gh is unauthenticated or there is no remote.** Would turn `axioms check` red on
every fresh project, offline machine and CI runner without gh, punishing environments instead of
drift. Rejected in favor of the printed notice. The cost is that "not verified" can hide real
drift until gh works; the notice names the blocker each run.

**Terraform or a settings app (Probot) for repo config.** A second toolchain and credential to
carry for one JSON document. `gh` is already how agents authenticate to GitHub here.

**A per-project review count, or zero reviews, for solo repos.** Raised while building the first
outside project, `small-tools`, whose owner could not merge anything. A project-side count is a
setting an agent working in that project could lower, and the harness keeps every wall out of the
project's reach. Zero reviews everywhere drops the one human check before `main`. A bot author
keeps the rule and makes the owner's review possible.

**A GitHub App as the bot.** It needs no second account, but its installation tokens last an hour
and are minted from a private key with a signed JWT, which `gh` does not do. A machine user's
token works with plain `gh`. An App can replace it later without changing the skill, since the
skill only reads `AXIOMS_BOT_TOKEN`.

## Consequences

- `axioms doctor` (and so `axioms check`) now spawns `gh` up to four times per run. Offline or
  unauthenticated runs stay green with a notice, so the gate degrades rather than blocks.
- The required status checks are coupled to the template's ci.yml job names. A test in
  `cli/rules.core.test.ts` parses both files and fails when they diverge, so renaming a CI job
  forces the ruleset file to follow.
- One approving review means a solo maintainer cannot approve a PR they opened themselves; with no
  bypass actors, the way through is a second identity, not a looser file. Loosening protection
  stays a reviewed factory change, not a settings tweak. A solo owner sets up the bot once per
  machine (`AXIOMS_BOT_TOKEN`) and adds the bot to each project as a collaborator. A PR the
  owner opens by hand still needs another reviewer.
- `tests/skills.test.ts` couples the skill to the ruleset: while the file requires a review, the
  pull-request skill must run `gh pr create` with `AXIOMS_BOT_TOKEN`.
- The first push of a project needs no `--no-verify`: `main` passes doctor as not verified, and
  the next push fails until `rules --apply` has run. Between the two pushes `main` is unprotected,
  which is the same window as the old "no remote yet" case.
- Rulesets on private repositories need GitHub Pro or a public repo. On the Free plan (the
  factory's own repo today) doctor reports GitHub's 403 message as not-verified and `axioms rules
  --apply` fails with the same reason, so the feature waits on the plan or on the repo going
  public rather than silently doing nothing.
- `gh` becomes the one way the harness talks to GitHub. A machine without it loses this gate only;
  every other doctor check still runs.

## Verification

- `bun run verify`: lint, typecheck, `cli/rules.core.test.ts` (green state from the shipped file;
  fixtures for a missing rule, a check not required, a review requirement below the file's,
  auto-merge off, an unreadable state, apply planning create/update/refuse, the arg parser, and
  the ci.yml job-name coupling), and the notes gate.
- Live, read-only, with gh authenticated as the repo owner: `bun cli/main.ts rules` (preview) and
  `bun cli/main.ts doctor` against Pierre-Mike/factory, a private repo on the Free plan. GitHub
  answers HTTP 403 "Upgrade to GitHub Pro or make this repository public", doctor prints the
  not-verified notice with that reason and the github gate adds no finding (the factory itself is
  not a generated project, so doctor's other checks report there regardless), and `rules` reports
  the same reason and exits nonzero. In a fresh `git init` directory with no remote, doctor prints
  "not verified: no git remotes found". That exercises the unavailable path end to end; the green
  and drift paths are proven by the fixture tests above, and `--apply` has not been run against a
  live repo.
- `cli/rules.core.test.ts` covers `branchLookupFailure`: a branch that exists, a 404, and any
  other failure passed through. Live, against Pierre-Mike/small-tools while it was empty: GitHub
  answered `default_branch: "main"`, `Branch not found (HTTP 404)` for the branch and `[]` for its
  rules. Doctor under v0.12.0 reported six github findings there; with this change it prints the
  one not-verified notice "main is not on Pierre-Mike/small-tools yet: push it, then run `bunx
  axioms rules --apply`" and no github finding.
- `tests/skills.test.ts` fails with the pull-request skill as v0.12.0 shipped it and passes with
  the `AXIOMS_BOT_TOKEN` line. The bot account itself is not tested: it needs a second GitHub
  login, which only the owner can create.
