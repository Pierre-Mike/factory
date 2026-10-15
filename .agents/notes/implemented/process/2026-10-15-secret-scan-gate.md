# Agent Note: gitleaks gates commits and CI against leaked secrets

Status: implemented

## Problem

Nothing stops a credential from leaving the machine. A key pasted into source lands in a commit,
the push carries it to GitHub, and from there it is public to everyone with read access and to
every clone. Rotation is the only fix at that point. The harness lints workflows (actionlint,
zizmor) and code (Biome, Grit), but no gate reads the content it is about to publish for secrets.

## Decision

gitleaks guards the two doors a secret can leave through: the commit and the pull request.

- `axioms secret-scan` (`cli/commands/secrets.ts`) wraps gitleaks the way `lint-workflows` wraps
  actionlint and zizmor: the Homebrew binary when installed; on a CI runner, a missing binary is
  downloaded at the pinned version (8.30.1) into `node_modules/.cache/axioms-tools`. A missing
  tool fails the gate instead of skipping it.
- The pre-commit hook in `harness/lefthook.yml` runs `axioms secret-scan --staged`
  (`gitleaks git --pre-commit --staged`) as its first job, so a staged secret stops the commit
  before Biome or the notes gate run. Projects inherit it through `extends`, with no sync step.
- A `secret-scan` CI job in the factory's and the template's `ci.yml` scans the committed history
  (`gitleaks git`) as a backstop for commits made without the hook. The job is plain `run:` steps,
  so `axioms ci-dry-run` replays it like every other job. `secret-scan` joins `CI_GATES` in
  `cli/doctor.core.ts`, so `axioms doctor` fails a project whose CI drops, skips or ignores it.
- Output is redacted (`--redact`): a finding names the file, line and rule, never the secret, so
  the scan does not copy the secret into terminals and CI logs.
- The rule is in `harness/canon.md`; the README names the gate next to actionlint and zizmor.

## Alternatives considered

**The official `gitleaks/gitleaks-action` in CI.** `ci-dry-run` replays `run:` steps and stands in
for checkout, setup-bun and cache only; any other action fails the plan, so the gate could never be
dry-run before a push. The action also wants a license key for organization repositories. The
`run:` step keeps the gate identical locally, in the dry run and on the runner.

**Fold the scan into `axioms check`.** `check` runs on pre-push and in its own CI job, which flags
the secret one commit too late: it is already in history, and rewriting is the cost the gate
exists to avoid. The staged scan belongs in pre-commit; the history scan gets a dedicated CI job,
shaped like `workflow-lint`.

**Scan the working tree (`gitleaks dir`).** It reads everything under the root, including
`node_modules` and wrangler's runtime binaries in CI, and still sees no more than the git modes
do. `gitleaks git` scans exactly what a push would publish.

**trufflehog.** Its verification mode tests candidate secrets against the real providers, which
sends the very values the gate exists to contain over the network. gitleaks runs offline and is a
single brew-installed binary, like actionlint.

## Consequences

- Committing in any project now needs gitleaks locally; a missing binary fails the commit with
  `brew install gitleaks`, the same treatment actionlint and zizmor give a push that touches CI
  files.
- CI pins 8.30.1 while Homebrew tracks latest, so rule sets can drift between the two; bumping the
  pin is one line in `cli/commands/secrets.ts`.
- The CI job scans the history the runner checks out: GitHub's depth-one checkout scans the full
  tree of HEAD as one diff, and the dry run's local clone scans every commit.
- A false positive is silenced by fingerprint in `.gitleaksignore` or an inline `gitleaks:allow`
  comment, never by removing the hook or the job.
- The gate stops new leaks only. A secret already in pushed history still needs rotation and a
  history rewrite; no gate repairs that.
- The selftest's planted token is assembled at runtime (`["ghp", "…"].join("_")`), so the
  factory's own history never contains a string its own scan would flag.

## Verification

- `bun run verify`: lint, typecheck, the unit tests including the extended `cli/doctor.core.test.ts`
  (a ci.yml without the job fails doctor; the healthy fixture carries it), and this note through
  the notes gate.
- `bun run selftest`: on a generated project, `axioms secret-scan --staged` flags a staged fake
  token, the installed pre-commit hook blocks the same commit, and the CI dry run replays the new
  `secret-scan` job clean on a fresh clone.
- By hand: `gitleaks git` over this repository's history finds nothing, a staged fake `ghp_` token
  in a scratch repository exits 1 under `--pre-commit --staged`, the pinned linux_x64 and
  darwin_arm64 release assets answer HTTP 200, and `bun cli/main.ts secret-scan` with `CI=1` and
  gitleaks off PATH downloads the pinned binary and passes.
