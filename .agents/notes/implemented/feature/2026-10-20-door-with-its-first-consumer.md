# Agent Note: A door is added with its first consumer

Status: implemented

## Problem

The canon tells a slice to publish a narrow `<feature>.door.ts` for other slices. fallow, the
dead code gate of `axioms check`, fails any door export that no other slice imports yet (issue
#9). An agent that designs the door first and writes its consumer second gets a red `check`, and
nothing tells it why or what to do. In two eval runs the agents trimmed every door in a separate
pass, or ended the run with a failing dead code gate.

A related rule was undocumented: a type used only inside an exported `Context.Service` signature
must not carry `export`, or fallow reports an unused type export. Agents dropped the keyword by
guessing.

`axioms slice <feature> --door` could only generate a door together with a new slice, so the moment
a door is needed (a second slice wants to read the first one) had no generator at all: running it
on an existing slice failed with "slice already exists".

## Decision

The strict dead code rule stays. A slice gets a door when another slice needs it:

- `axioms slice <feature> --door` on an existing slice adds only `<feature>.door.ts`. It refuses a
  slice without `<feature>.io.ts` ("<feature> has no <feature>.io.ts, so there is no service for a
  door to publish") and a slice that already has a door. Without `--door`, an existing slice still
  fails, and the message now points at `axioms slice <feature> --door`.
- After the door is written, the command prints one next step: import `<Feature>Io` from
  `"../<feature>/<feature>.door"` in the consuming slice's `*.routes.ts`, name it in
  `RouteRuntime<...>`, in the same change, because fallow fails the door until a slice imports
  it. A new slice generated with `--door` prints the same step.
- When fallow fails, the dead code gate prints a hint under its report: for each door it lists,
  the canon rule and the import to add (or the export to delete); for an unused type export, that
  a type used only inside an exported signature drops its `export`.
- The canon gains two rules, both enforced by fallow: a door exports only what another slice
  already imports, added with its first consumer; a type used only inside an exported signature
  stays unexported.

The pure parts live in `cli/slice.core.ts`: `planSlice` (new slice, door only, or the refusal),
`doorFiles` (shared by both paths), `doorNextSteps` and `unusedExportHints`. The shell is
`cli/commands/slice.ts` and the dead code gate in `cli/commands/check.ts`, which now always
captures fallow's output to read it.

## Alternatives considered

**Treat `*.door.ts` as a fallow entry point.** Unused door exports would warn instead of fail. The
maintainer chose the strict rule: a door with no consumer is speculative API, and an entry-point
glob would also hide exports that lost their last consumer.

**A separate `axioms door <feature>` command.** It names the action well but adds a command, a help
line, and a second argument parser for the same file the `--door` flag already generates. Reusing
`--door` keeps one generator and one usage line; the existing slice folder tells the two cases
apart.

**Generate the consumer's import too (`--door --for <consumer>`).** The generator would have to
edit a route it did not write, and an import nothing uses yet fails Biome instead of fallow. The
agent writes the read that needs the service anyway, so it adds the import there.

**Keep `check` green between the door and its consumer.** Not possible with the strict rule: the
door alone is dead code. The printed next step tells the agent to add the import in the same
change, and the failing gate repeats the fix, so every step the agent is told to finish ends green.

## Consequences

- `axioms slice x --door` followed straight by `axioms check` fails the dead code gate, with the
  hint naming the import to add. fallow reports a door nothing imports as an unused file, and a
  door that is partly imported as unused exports; the hint reads both. Adding the import makes the
  gate pass.
- A door that re-exports anything besides the io Tag still has to be edited by hand.
- The dead code gate always pipes fallow's output so it can read it, so on a terminal fallow sees
  a pipe and may print without color.

## Verification

- `cli/slice.core.test.ts`: `planSlice` for a new slice, a door on an existing slice, and the three
  refusals; `doorFiles` matches the door `sliceFiles` adds; `doorNextSteps` and `nextSteps` with
  `door: true` name the import and fallow; `unusedExportHints` for a door export, an unused type
  export, and other dead code.
- `bun run selftest`: `axioms slice search --door` fails on the `--no-io` slice; `axioms slice
  widgets --door` adds the door and prints the import; `axioms check` then fails with
  `check failed: dead code` and the hint; after `search.routes.ts` imports `WidgetsIo` from the
  door and reads through it, `axioms check`, smoke, the deploy dry run and the CI dry run pass.
