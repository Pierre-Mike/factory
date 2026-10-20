# Agent Note: check names files that need formatting instead of printing Biome's diff

Status: implemented

## Problem

The lint gate of `axioms check` ran `biome ci .` and passed its output through. For a formatting
error Biome prints a diff with one ANSI color span per character, and it keeps the color when its
output goes to a pipe. A two-line reflow in one test file came out as hundreds of lines of escape
codes. Agents read `check` output as plain text, so in the Zeeter one-prompt eval (issue #10) they
stopped reading the lint section and ran `bun run lint` before every `check` instead. A gate whose
output nobody reads stops guiding the fix.

## Decision

The lint gate lives in `cli/commands/lint.ts`, with the parsing in `cli/lint.core.ts`.

- Biome runs once as `biome ci --reporter=json --colors=off --max-diagnostics=none .`, captured
  and not shown. `parseBiomeJson` reads each diagnostic's category, path and severity, and
  `classifyLint` splits them. A `format` diagnostic or an `assist/*` one (import sorting) is a
  finding that `bun run lint` (`biome check --write`) fixes. Anything else, or diagnostics Biome
  left out of the report, means the full diagnostics must be shown.
- Files with fixable findings print as a list, at most 20 names and then `… and N more`, followed
  by ``run `bun run lint` to fix``. Biome's formatter diff never prints.
- When other findings exist, Biome runs a second time with `--formatter-enabled=false
  --assist-enabled=false`, so only lint rule diagnostics print, in full. Under `--json` /
  `--report` that second run uses `--reporter=summary`, so the gate's capped evidence names files
  and rules instead of code frames.
- Every Biome run that prints gets `--colors=off` unless both stdout and stderr are terminals.
- If the json run produces no report, or fails with no diagnostics (a bad config, no files
  processed), the gate reruns plain `biome ci .` so Biome's own message shows.
- The verdict is still the json run's exit code, so warnings alone pass as before.

## Alternatives considered

**Always `--colors=off`, keep the diff.** The diff without color is still one block per changed
line, and a reflow changes many lines. The agent needs the file name and the command, and the diff
adds nothing an agent acts on.

**Run `biome check --write` from `check`.** A gate that edits files would change the tree under
the pre-push hook and in CI. `check` reports and the agent fixes.

**Render every diagnostic from the json report.** The json reporter drops Biome's code frames and
fix suggestions, which lint rule findings need. A second Biome run with the formatter off keeps
Biome's own rendering for those and costs about a tenth of a second.

**Parse the `summary` or `github` reporter.** Both are text formats meant for people or the
GitHub annotation parser. The json reporter is marked unstable by Biome, but its shape is checked
by `parseBiomeJson`, and an unrecognized document falls back to plain `biome ci`.

## Consequences

- An agent sees a formatting-only failure as a few lines naming the files and the fix command.
- A lint failure costs a second Biome run. Biome is pinned in `package.json`, so a change to the
  json reporter's shape shows up in the selftest when the pin moves.
- The fix command is always `bun run lint`. The template defines it, and `axioms adopt` adds it
  when the repo has none. An adopted repo whose own `lint` script does something else gets a fix
  hint that may not fix.
- Safe lint fixes that `--write` would also apply still print as lint diagnostics. Biome's json
  report does not mark a fix as safe in a field, only in advice text.

## Verification

- `bun test cli/lint.core.test.ts`: parsing Biome's json report and refusing other text, sorting
  fixable files apart from lint rule findings, the 20-file cap (a fast-check property) and the
  color flag.
- `bun run selftest`: in a generated project, a reflowed `health.core.ts` makes `axioms check`
  fail, name the file and print ``run `bun run lint` to fix``. The lint section stays within 10
  lines (Biome's diff of that file is 62 lines, 29 KB with color) and the whole run under 200.
- `bun cli/main.ts check --json` on the factory with a reflowed file: the lint gate's `errors`
  hold the file list, the fix command and Biome's summary of the remaining warnings, with no ANSI
  escapes.
