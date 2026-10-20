---
name: tdd
description: Test-driven development in a factory project. Use when building a feature or fixing a bug test-first, when the user mentions TDD, red-green-refactor, a failing test or a regression test, and whenever you write, change or decide to keep a test.
---

# Test-driven development

Red, green, refactor, one small slice at a time. This skill says where each test goes in a
factory project, what makes a test worth keeping, and what evidence to report when you finish.
The rules in the canon block of `AGENTS.md` still apply; this skill never overrides them.

## Where a test goes

A factory project has three test layers. Choose the layer from the behavior you are pinning, and
don't ask the user where a test goes when the layer is obvious.

| Behavior | Test file | How it runs |
|---|---|---|
| Domain logic: a calculation, a parse, a rule, a tagged failure | `features/<f>/<f>.core.test.ts` next to `<f>.core.ts` | Plain data in and out. No Effect runtime, no clock, no mocks. |
| HTTP mapping: status codes, the `ApiErrorBody` envelope, query and body decoding | `features/<f>/<f>.routes.test.ts` | `testApp().request("/api/<f>")` from `platform/test-app.bun.ts`: the real app over the real migrations on in-memory SQLite. A `ManagedRuntime` over test Layers only for a service you must fake |
| Wiring: the Worker, D1, assets, `api.ts` mounts | `apps/server/smoke/<f>.smoke.test.ts` | `bun run smoke` against `wrangler dev` |

Push each test as low as it can go. A rule you can test in the core doesn't belong in a route
test, and a route test doesn't need a smoke test to prove the same thing again. Ask the user only
when a behavior doesn't clearly belong to one layer.

In a repo without `apps/server` (a lite repo set up with `axioms adopt`), use the project's
existing test layout and keep the rest of this skill.

## What a good test is

A test claims something about what the code does for its users: a caller, an end user or another
service. Users can observe return values, failures, state they can read back, and effects on
outside systems (a row written, a request sent). They can't observe private helpers, call order
or which internal function did the work.

Check every test you write or keep against two edits you imagine making to the code:

1. **Break the behavior.** Return the wrong value, skip the effect, or do it twice. If the test
   still passes, it proves nothing.
2. **Change the internals.** Restructure the code and keep every observable result the same. If
   the test now fails, it's pinned to the implementation and will break on every refactor.

Keep a test that fails the first edit and survives the second. Rewrite or delete the others.

The contract decides what to assert:

- **Assert on the failure's `_tag`**, never its message. Callers branch on the tag
  (`STATUS_BY_TAG` maps it to a status), and nobody reads the wording.
- **Take expected values from the requirement.** Use a literal or a worked example. Don't
  recompute them the way the code does, or the test passes by construction.
- **An assertion that something did not happen** needs a sibling case where it does happen.
  Otherwise you can't tell whether the test can see it at all.

See [examples.md](examples.md) for each of these in the project's idiom.

## The loop

1. **Name the slice.** Pick one behavior, the smallest one that's still useful end to end.
2. **Red.** Write one test for it in the right layer. Run `bun test <file>` and confirm it fails
   *for the reason you expect*. A test that fails on a typo or a missing import hasn't failed yet.
3. **Green.** Write the least code that makes it pass. No speculative options, no code for the
   next test.
4. **Refactor.** With the test green, clean up names and duplication, then run it again.
5. **Repeat** with the next slice. One test, then one implementation, then the next. Don't write
   the whole suite up front: those tests describe behavior you imagined before the code taught you
   anything, and they tend to pin shape instead of behavior.

When a non-trivial core function has a few examples passing, add a fast-check property for the
rule it must always keep (uptime is never negative; the parse is total and never throws). A
property that recomputes the answer the way the code does is still tautological.

Finish every feature with `bun run check`, and with `bun run smoke` when routes or wiring changed.

## Fixing a bug

1. Reproduce the bug at the **lowest layer** that shows it, as a failing test.
2. Run it and confirm it fails for the reason the bug report describes. If it fails for some
   other reason, or passes, fix the test or the reproduction before you touch the code.
3. Make the smallest fix that restores the intended behavior.
4. Rerun the test, then `bun run check` (and `bun run smoke` for a route or wiring bug).

Never edit a test to match a wrong implementation, and never weaken an assertion to get to green.
Change an assertion only when the intended behavior changed, and say why.

## Test doubles

The only seam to fake is an `*.io.ts` service. Provide a fake with `Layer.succeed(Service, {...})`
and build the runtime from it, as `health.routes.test.ts` does with its frozen clock. Don't mock a
core module, a route or an internal helper, and don't use `mock.module`. Run database tests
through `testApp()` from `platform/test-app.bun.ts`, which applies the real migrations to a fresh
in-memory SQLite database, not against a mocked SQL port.

Inject clocks, randomness and ids as data. Core tests pass `now` in. Tests may use Bun APIs; code
under `src/` may not.

## Report

When you finish, name the evidence, not just the result:

- the failing run (test name and the failure it printed), for a bug fix or a new behavior;
- the passing run afterwards;
- the gate commands you ran (`bun run check`, `bun run smoke`) and their outcome. `--json` gives
  harness-written evidence when another agent or program needs to read it.

If you couldn't show the failure first, say so and say why.

Sources and licenses: [CREDITS.md](CREDITS.md).
