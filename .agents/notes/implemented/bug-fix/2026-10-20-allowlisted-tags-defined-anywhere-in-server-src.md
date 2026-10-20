# Agent Note: allowlisted tags may be defined anywhere in server src

Status: implemented

## Problem

`axioms doctor` fails when `STATUS_BY_TAG` in `platform/http.ts` allowlists a tag that no code
creates, so a dead tag cannot linger in the allowlist. To decide whether a tag is created, it
searched every non-test `.ts` file under `apps/server/src` except `platform/http.ts`. A tag that
`platform/http.ts` itself creates, such as one the boundary answers for a framework error, always
counted as orphaned. The message called the searched code "feature code", though `platform/` was
searched too, and its only remedy was to delete the tag, which breaks the code that creates it.

## Decision

The doctor searches every non-test `.ts` file under `apps/server/src`, `platform/http.ts`
included, after removing the `STATUS_BY_TAG` object literal from that file. A tag counts as created
when its name appears as a string literal (`"Tag"`) anywhere in that text. A key of the allowlist
never counts as its own definition, quoted or not.

The finding reads `STATUS_BY_TAG allowlists "<Tag>", but no code under apps/server/src creates it`
and offers both remedies: create the tag where that failure happens, or remove it from
`STATUS_BY_TAG`.

`cli/commands/doctor.ts` passes every `.ts` file with its path (`DoctorInput.serverSources`). The
pure core (`cli/doctor.core.ts`) drops test files and the allowlist literal, so the cases are unit
tested.

## Alternatives considered

**Keep excluding `platform/http.ts` and move such tags to another file.** That is what an agent
did in the Zeeter eval after reading the doctor's source. It makes the file layout depend on a
quirk of the check.

**Parse the server with the TypeScript compiler and look for `_tag` properties.** More precise,
but tags are also built in helpers and type unions. A string-literal search has matched every real
case so far.

## Consequences

- A tag mentioned only in a comment as `"Tag"` still counts as created. The check stays a
  safety net against forgotten tags, not a proof that a tag is reachable.
- `parseAllowlistedTags` also reads quoted keys (`"Tag": 400`).

## Verification

- `cli/doctor.core.test.ts`, `describe("allowlisted tags")`: a tag created in `platform/http.ts`
  outside the literal passes; a tag that is only an allowlist key fails; a tag only a test creates
  fails; the finding names both remedies.
