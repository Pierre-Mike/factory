# Agent Note: a gate baseline and hash-verified scanners keep CI honest

Status: implemented

## Problem

A green run says no gate failed. It does not say the gates still check as much as they did. Delete
a test file, narrow Biome's include list, or drop a note tree, and every gate passes with fewer
checks behind it. Nothing in CI notices.

The scanners have a second gap. CI installs gitleaks, actionlint and zizmor at pinned versions, but
the download itself is trusted. gitleaks came through `curl | tar`, actionlint through a bash
script fetched at run time, and zizmor through `pipx` or `uvx` with no hash. A swapped release
asset or a compromised download path runs inside the job that holds the repo's token.

## Decision

**Gate baseline.** `axioms baseline` (`cli/commands/baseline.ts`) runs Biome, the tests and the
notes gate, reads how many checks each reported (`Checked N files`, `N pass`, `N Agent Note(s)`),
and compares the totals to `gate-baseline.json`, committed at the repo root. A total below the
baseline fails the run and names the gate. A total above it passes and prints a hint to run
`axioms baseline --update` and commit the new file. A gate that prints no count fails too, because a
gate that stops reporting has stopped checking. The parsing and comparison are pure in
`cli/baseline.core.ts`. CI runs it as the `gate-baseline` job in this repo's `ci.yml`.

**Pinned scanners.** `cli/tools.core.ts` holds, for gitleaks, actionlint and zizmor, one exact
version and one release asset per platform, each with the SHA256 of the archive. On a CI runner,
`installPinned` (`cli/commands/tools.ts`) downloads the asset, hashes the bytes, and refuses to
extract unless the digest matches the pin. All three tools now come through that one path; the
actionlint download script and the `pipx`/`uvx` zizmor route are gone. Locally the Homebrew binary
still wins. Every `uses:` in the workflows is already pinned by commit SHA with a version comment,
and zizmor's unpinned-uses audit keeps it that way.

To bump a scanner, change its version constant and the SHA256 values in `cli/tools.core.ts`, taking
them from the release's checksums file.

## Alternatives considered

**Compare gate names only.** It catches a removed gate but not a deleted test, which is the likelier
loss.

**Fail on any difference from the baseline.** It also catches a baseline nobody raised, but every
added test would need a baseline edit in the same pull request. A ratchet that only blocks loss
costs less and guards the thing that matters. A raised total prints a hint instead.

**`gitleaks/gitleaks-action` and similar actions.** The secret-scan note already rejects them: the
CI dry run cannot replay them.

**Verify through the release's `checksums.txt` at run time.** It downloads the digest from the same
place as the archive, so one compromise covers both. Committed hashes change only through review.

**`pip install --require-hashes` for zizmor.** It needs per-wheel hashes for each platform and the
dependency tree. The release binary has one hash per platform.

## Consequences

- A deliberate removal of tests or files now needs `axioms baseline --update` in the same pull
  request, so the reduction shows in review as a diff to `gate-baseline.json`.
- The baseline counts what the gates print. If Biome or bun reword those lines, `baseline` fails
  with "reported no count" until `cli/baseline.core.ts` follows; the unit tests pin the current text.
- Bumping a scanner is a three-part edit: version, four hashes per tool, then a run on CI. The
  tests reject a malformed hash, a missing linux-x64 asset and a URL that does not carry its version.
- The template's `ci.yml` and `axioms doctor` do not require the baseline yet. Projects can run
  `bunx axioms baseline` themselves; wiring it into the template is a follow-up.
- The six required checks (`check`, `smoke`, `deploy-dry-run`, `pr-body`, `workflow-lint`,
  `secret-scan`) are unchanged, and so is the GitHub ruleset. `gate-baseline` is an extra job in the
  factory's own CI and becomes required only if someone adds it to `harness/github.rules.json`.

## Verification

- `bun run verify`: Biome, typecheck, the unit tests (`cli/baseline.core.test.ts`,
  `cli/tools.core.test.ts`) and the notes gate.
- `bun cli/main.ts baseline` passes against the committed file. Deleting a test and rerunning it
  fails with `tests: N reported, baseline M`.
- `CI=1 PATH=<without the scanners> bun cli/main.ts secret-scan` and `lint-workflows` download the
  pinned assets and pass. Editing one hash in `cli/tools.core.ts` makes them fail with
  `SHA256 mismatch`.
