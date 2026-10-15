# Agent Note: PR template and body gate

Status: implemented

## Problem

A pull request's body is the only place the author states what changed, why, how it was verified
and which Agent Note owns the decision, yet nothing defines that contract and nothing fails a PR
that arrives without one. Agents open PRs with `gh pr create`, which does not auto-fill
`.github/PULL_REQUEST_TEMPLATE.md`, so shipping a template alone changes nothing: the body stays
empty and review starts from the diff.

## Decision

- `template/.github/PULL_REQUEST_TEMPLATE.md`, and the factory's own copy at
  `.github/PULL_REQUEST_TEMPLATE.md`, define four sections: `## What changed`, `## Why`,
  `## Verification` (the commands run) and `## Owning Agent Note` (the path to the note). Hints
  are HTML comments, so an unedited template never passes.
- `cli/pr-body.core.ts` is the pure gate: `templateHeadings` reads the required sections out of a
  template, `sectionProblems` reports each one a body misses or leaves empty, and
  `eventPullRequestBody` lifts the body (null for a descriptionless PR) out of a pull_request
  payload. CRLF and comments are stripped before judging. `tests/pr-template.test.ts` pins both
  shipped templates to exactly those sections and proves the unedited template fails all four.
- `axioms pr-body [file|-]` (`cli/commands/pr-body.ts`) supplies the body from a file, stdin, or,
  with no argument, from `GITHUB_EVENT_PATH` when `GITHUB_EVENT_NAME` is `pull_request`. Any other
  event passes with a stated reason. The required headings come from the project's own
  `.github/PULL_REQUEST_TEMPLATE.md`; a missing template fails the gate.
- Both ci.yml files run the gate as an unconditional `pr-body` job, `pr-body` is in `CI_GATES` in
  `cli/doctor.core.ts` so a project cannot drop the job silently, and the canon rule in
  `harness/canon.md` tells agents to build the body from the template and names the gate.

## Alternatives considered

- A step-level `if: github.event_name == 'pull_request'` in ci.yml: `axioms ci-dry-run` refuses
  conditional steps and `axioms doctor` discounts a skippable gate. Deciding inside the command
  keeps the YAML unconditional and both tools honest.
- Extracting the body in the workflow with `jq` and `${{ }}`: expressions in `run:` fail the dry
  run, and interpolating a PR body into a shell line is the injection pattern zizmor exists to
  catch. The command reads the payload file itself instead.
- Hardcoding the four headings in the CLI: the shipped template and the gate drift apart. Parsing
  the project's template keeps one source of truth and enforces any section a project adds.
- A `pull_request_target` or push-time check: only `pull_request` events carry the body being
  reviewed, so the gate checks exactly that and no more.

## Consequences

- An empty or template-shaped body fails CI, so the author writes the contract or the PR stays
  red. A deleted template or a dropped job also surfaces: the gate fails on the missing file, and
  doctor fails the ci.yml.
- The `pr-body` job also spins up on pushes to main and no-ops with a printed reason; that is the
  price of staying visible to doctor and reproducible in the dry run.
- `axioms sync` does not rewrite ci.yml or the PR template, so an existing project that bumps the
  harness sees doctor name the missing gate and copies the job and
  `.github/PULL_REQUEST_TEMPLATE.md` from the factory template by hand.

## Verification

- `bun run verify`: Biome, tsc, the unit tests (`cli/pr-body.core.test.ts` covers filled, empty
  and missing sections; `tests/pr-template.test.ts` pins both templates) and the notes gate, green.
- `bun run selftest`: the generated project carries the template and the `pr-body` job, `axioms
  check` (doctor with the new gate) passes, and `ci-dry-run --all` replays the job to its stated
  no-op pass, green.
- `bun cli/main.ts pr-body <file>` on a filled body exits 0; on the unedited template it names all
  four sections as empty and exits 1.
