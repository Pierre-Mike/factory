# Agent Note: evidence reports for check and smoke

Status: implemented

## Problem

A gate run ends as scrollback: `axioms check` and `axioms smoke` print human logs and leave an
exit code, nothing else. A program that wants to know which gate failed and why has to scrape the
logs, and an agent session that delegates a run to a worker ends up asking the worker how it went.
A worker describing its own success is exactly the evidence that cannot be trusted. Nothing the
harness itself writes is machine-readable.

## Decision

`axioms check --json` and `axioms smoke --json` print one JSON document on stdout:

```json
{
  "command": "check",
  "pass": false,
  "passed": 8,
  "failed": 1,
  "skipped": 0,
  "durationMs": 23145,
  "gates": [
    { "name": "lint", "pass": true, "durationMs": 1203 },
    { "name": "test", "pass": false, "durationMs": 1810, "errors": ["..."], "omittedLines": 42 }
  ]
}
```

- **Stdout shape: one document, not one object per line.** A consumer calls `JSON.parse` once on
  the whole stdout (or pipes it to `jq`), and the summary cannot arrive without its gates. NDJSON
  framing only helps a live dashboard, which nothing needs; it would force every consumer to
  split, parse N times and stitch the summary back to the gates.
- In evidence mode, stdout carries exactly that document. Every other byte (gate banners, tool
  output, wrangler logs) goes to stderr, teed from the captured streams, so a human can still
  watch the run.
- Per gate: `name`, `pass`, `durationMs`. On failure, `errors` holds the first 20 lines the gate
  wrote (ANSI escapes stripped, each line capped at 400 characters) and `omittedLines` counts what
  truncation dropped. The full stream remains on stderr.
- **A skipped gate passes and says why.** `check` skips typecheck in a repo with no root
  `tsconfig.json` and the test gate when no file matches Bun's test discovery, which an adopted
  repo may lack ([axioms adopt](./2026-10-15-axioms-adopt.md)). Such a gate returns
  `{ skipped: reason }` instead of a boolean (`GateVerdict` in `cli/commands/gates.ts`). The
  runner prints `– <gate> skipped: <reason>`, the gate's evidence is `"pass": true` plus
  `"skipped": "<reason>"`, and the summary's `skipped` counts those gates. `passed` includes
  them, so `passed + failed` is still the number of gates, and the human summary names them:
  `✓ check: all gates passed (skipped: typecheck)`.
- **The exit code is part of the contract**: a failing gate still exits non-zero with `--json`,
  so the flag is safe in hooks and CI, and a consumer that only checks the code loses nothing.
- `--report <path>` writes the same rendered document to a file; it works with or without
  `--json` because both come from the same core output.
- `check` keeps running all gates after a failure, as before. `smoke` stops at the first failing
  phase (later phases need the earlier ones), so its report lists only the phases that ran:
  `build web`, `migrations`, `wrangler dev`, `smoke tests`, `behavior` (see
  [the behavior pass](2026-10-20-smoke-behavior-pass.md)). Counts reflect executed gates.
- A gate that throws (a crashing tool, a missing file) is recorded as a failed gate with the error
  as its evidence instead of killing the process before the report exists. The run's summary and
  exit code count it as failed, and `check` still runs the remaining gates.
- Without a flag, behavior is unchanged: inherited stdio, same banners, same exit codes. The only
  cosmetic difference is that smoke now prints the same `── gate ──` banners and failure summary
  style as check. Both commands now refuse unknown arguments, like `axioms deploy`.

Implementation: `cli/report.core.ts` is the pure core (flag parsing, truncation, aggregation,
rendering) with its co-located test; `cli/commands/gates.ts` runs and times gates, teeing their
`console.error` lines and, through the `sink` option on `run`/`runTool` in `cli/shell.ts`, their
child-process output into the evidence; `cli/commands/check.ts` and `cli/commands/smoke.ts` only
declare their gates; `cli/main.ts` parses the flags, prints and exits. The canon's rule list names
the contract.

## Alternatives considered

**One JSON object per line (NDJSON).** Lost for the reasons above: every known consumer wants the
final verdict in one parse, and streaming per-gate lines buys nothing a sequential run needs.

**A worker-side convention ("paste your gate output into the report").** Rejected outright: the
goal is evidence the harness writes, so a session never depends on a worker's account of itself.

**Refactor notes/doctor to return messages instead of printing.** Threading a logger through every
command rewrites all of them for the same evidence; teeing `console.error` around a gate captures
the same lines in one place. Revisit if a gate ever needs structured sub-results.

**Always write a report file, no flag.** Litters every run of every project with an artifact
nobody asked for, and the task is solved by stdout plus an opt-in file.

**Print the skip, report a plain pass.** The smallest way to combine skips with this report: the
log says "skipped", but the evidence shows a passing typecheck that never ran, which is the
self-reported success this report exists to replace. The reason travels with the verdict instead.

**Skipped as a third bucket, outside `passed`.** Three disjoint counts read cleanly, but a gate
would then say `"pass": true` while the summary does not count it as passed, and every consumer
that checks `passed + failed` against the gate list would break. Counting skips inside `passed`
and adding `skipped` keeps the per-gate and summary numbers consistent.

## Consequences

- An agent session runs `bunx axioms check --json` and parses stdout; no log scraping. The exit
  code still gates hooks and CI unchanged.
- In evidence mode child tools run piped, not on a TTY, and `errors` strips ANSI escapes either
  way. Biome keeps its color in a pipe, so the lint gate passes it `--colors=off` and uses its
  summary reporter for evidence ([check lint output](../bug-fix/2026-10-20-check-lint-output.md)).
- `errors` is capped evidence (20 lines, 400 characters per line), not a full log. The full output
  is only on stderr, so a consumer that needs more than the first lines must re-run or capture
  stderr itself.
- The `console.error` tee is per gate and only while collecting; a gate that writes to stderr
  through some other channel than `console.error` or a spawned child would bypass the evidence.
  None does today.
- `axioms check --help` no longer prints the global help; unknown arguments are refused with the
  usage line, the same stance `axioms deploy` took.

## Verification

- `bun run verify`: Biome, `tsc --noEmit`, the unit tests including `cli/report.core.test.ts`
  (pass, a skipped gate with its reason and count, failure truncation, empty run, flag refusal, a
  fast-check property on the limits), and the notes gate — green.
- `bun run selftest:adopt`: in an adopted repo with no tsconfig.json, `axioms check --report`
  writes a report whose typecheck gate passes with `"skipped"` naming the missing tsconfig.json,
  whose test gate ran, and whose `skipped` count is 1.
- `bun cli/main.ts check --json` on the factory itself prints one parseable document on stdout
  (9 gates, failing ones carrying `errors`) and exits 1; `... | jq .pass` reads it. On a passing
  tree it exits 0 with `"pass": true`.
- `bun cli/main.ts check --json --report /tmp/r.json` writes the identical document to the file.
