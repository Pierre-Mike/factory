# Agent Note: `axioms slice --no-io`, and doctor names the stub tag's slice

Status: implemented

## Problem

`axioms slice <feature>` always writes a stub io service, registers `<Feature>IoLive(deps)` in
`Layer.mergeAll` in `platform/runtime.ts`, and adds `Invalid<Feature>Id: 400` to `STATUS_BY_TAG`
in `platform/http.ts`. Two things go wrong in real projects (issue #5):

- Slices such as profiles or search own no table and compose other slices through their doors.
  The agent deletes the generated `*.io.ts` and edits `runtime.ts` by hand, and only `tsc` checks
  that edit.
- The stub core defines `Invalid<Feature>Id`. Once the agent replaces the stub core, the tag is
  orphaned and `axioms doctor` fails with "remove it from platform/http.ts", with no hint that the
  generator put it there. In the Zeeter eval five slices left five orphaned tags.

## Decision

`axioms slice <feature> --no-io` writes no `<feature>.io.ts`, leaves `runtime.ts` untouched (it
needs no `Layer.mergeAll` anchor) and generates a route over `RouteRuntime<never>` that calls the
pure core and nothing else. Its header says to import another slice's door and name that service
in `RouteRuntime<...>` when the slice needs one. The route test runs through `testApp()` either
way. `--door` with `--no-io` is refused: the door re-exports the io service, and there is none.

Argument parsing moved into `parseSliceArgs` and the usage line into `SLICE_USAGE` in
`cli/slice.core.ts`: `axioms slice <feature> [--door] [--no-io]`. The next steps the command
prints come from `nextSteps`, which drops the io steps for `--no-io` and says to remove
`Invalid<Feature>Id` once the core no longer defines it.

The generator still registers the stub tag. When doctor finds an orphaned allowlist entry equal
to `Invalid<Feature>Id` for an existing feature folder, its remedy names the slice:

> remove InvalidPostsId from platform/http.ts: `axioms slice posts` added it for the stub core,
> which no longer uses it

Other orphaned tags keep the plain remedy.

## Alternatives considered

**Register the stub tag only while the stub core uses it.** The generator runs once and cannot
see the core change later. Making the entry conditional needs either a marker in `http.ts` that
some tool reads on every check, or a doctor that edits `http.ts` itself. Both add a mechanism next
to the orphan check doctor already runs. Naming the slice reuses that check and adds one string.

**Generate the stub without a tag.** The stub core is the example of a tagged failure lifted with
`Effect.fromResult` and mapped to the shared 400 envelope. Without a tag the generated slice stops
teaching the pattern the canon requires.

**A doors-only slice that still gets an empty io file.** It keeps one code path in the generator
but leaves a Layer in `runtime.ts` that provides nothing, which is the edit agents were making by
hand.

**Allow `--door` with `--no-io` and publish the core.** A door that re-exports pure functions is
possible, but no slice has needed one yet. Refusing the pair keeps the door's meaning (the service
Tag) until a case shows up.

## Consequences

- A `--no-io` slice that later needs storage gets its io file by hand (copy the shape from a
  generated slice) and its Layer added to `runtime.ts`.
- The orphaned stub tag still fails `axioms check` until it is removed. The failure now says where
  it came from.
- `cli/doctor.core.ts` imports `pascalCase` from `cli/slice.core.ts`, so both agree on the tag name.

## Verification

- `cli/slice.core.test.ts`: `--no-io` produces no io file and a route without the io service;
  `wireSlice` with `io: false` returns `runtime.ts` unchanged and needs no `mergeAll` anchor;
  `parseSliceArgs` reads both flags, refuses unknown flags and `--door --no-io`; `SLICE_USAGE`
  names `--no-io`; `nextSteps` drops the io steps and names the tag to remove.
- `cli/doctor.core.test.ts`: an orphaned `InvalidUserPostsId` with a `user-posts` feature gets a
  remedy naming `axioms slice user-posts`.
- `bun run selftest`: `axioms slice search --no-io`, then `git diff --exit-code` on `runtime.ts`;
  the slice's files are rewritten to fail with `InvalidSearchQuery`, `axioms doctor` must fail and
  mention `InvalidSearchId` and `` `axioms slice search` ``; after the allowlist entry is renamed,
  `axioms check`, smoke and the CI dry run pass with the slice in place.
