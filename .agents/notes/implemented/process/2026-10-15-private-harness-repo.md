# Agent Note: The harness repo is private

Status: implemented

## Problem

The factory repo was public under the MIT license. Its owner is the only user and wants to keep
the harness and its history to themselves. Projects install the harness straight from that repo
on two kinds of machine: the owner's laptop and each project's GitHub Actions runner. A repo that
refuses anonymous reads must still install on both, and the CI dry run must still replay every
job.

## Decision

The repo is private, `LICENSE` reserves all rights (versions up to v0.9.0 stay MIT, since that
grant cannot be withdrawn), and `package.json` says `"license": "UNLICENSED"` and `"private": true`.

- The pinned spec (`releaseSpec` in `cli/new.core.ts`) is
  `git+ssh://git@github.com/Pierre-Mike/factory.git#vX.Y.Z`. Bun 1.3.6 resolves `github:` and
  `git+https://github.com` specs by downloading an API tarball and sends no `Authorization`
  header, even with `GITHUB_TOKEN` set, so the private repo answers 404. Bun hands a `git+ssh`
  spec to `git`, whose auth applies.
- Locally, a machine with no GitHub SSH key sets
  `url."https://github.com/".insteadOf "ssh://git@github.com/"` once, and the gh credential
  helper answers.
- In CI, every job of the template's `ci.yml`, and of the workflow `axioms adopt` stamps
  (`liteCiWorkflow` in `cli/adopt.core.ts`), has a step with `id: harness-access` before
  `bun install`. It rewrites `ssh://git@github.com/Pierre-Mike/factory` to HTTPS with the
  `HARNESS_TOKEN` secret, a fine-grained token with read-only Contents access to this one repo,
  and fails with a clear error when the secret is empty. `axioms new` prints the
  `gh secret set HARNESS_TOKEN` step.
- `axioms doctor` flags a `github:` or `https://github.com` harness spec, and any CI job that runs
  `bun install` without `harness-access` before it.
- `axioms ci-dry-run` treats the `harness-access` step as provided, like `actions/checkout`.
  Replaying it would write an `insteadOf` with an empty token into the developer's global git
  config and break their access.

## Alternatives considered

**Keep `github:` specs and set `GITHUB_TOKEN`.** Bun's help text lists `GITHUB_TOKEN`, but in
1.3.6 the tarball request goes out with no auth header and gets a 404. Tested against the private
repo with a token that `curl` could use.

**SSH deploy keys.** The owner's machine has no GitHub SSH key, and each project would need a
private key secret plus `known_hosts` handling. A read-only HTTPS token and an `insteadOf`
rewrite cover both machines with less setup.

**A composite action in this repo for the access step.** Other repos can only use actions from a
private repo after its Actions access setting is changed, and the dry run would still need to
stand in for it. A plain `run:` step with a fixed `id` is simpler and doctor can check it.

**Publish to GitHub Packages.** It needs a token in CI as well, plus a publish step on every
release and an `.npmrc` scope in every project, for no gain over git.

## Consequences

- Projects generated or adopted before v0.10.0 pin `github:` specs and fail `bun install` with a
  fresh cache. Moving one to v0.10.0 means pinning the new spec, adding the `harness-access` step
  to each job (doctor names the jobs), and setting `HARNESS_TOKEN`.
- `bun install` in any project needs the local `insteadOf` rewrite or an SSH key. A new machine
  fails on its first install until one is set.
- A fork PR to a project gets no secrets, so its CI cannot install. There are no outside
  contributors, so this costs nothing today.
