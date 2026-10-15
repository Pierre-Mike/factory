## What changed

`GET /api/health` accepts `?verbose=1` and adds `verbose: true` to the response. An invalid flag
returns the shared 400 envelope.

```diff
 features/health/
   health.core.ts         # parseVerbose: string -> Result<boolean, InvalidVerboseFlag>
   health.routes.ts       # lifts parseVerbose with Effect.fromResult
 platform/http.ts
+  InvalidVerboseFlag: 400
```

## Why

Operators need the uptime breakdown without a second endpoint. The note decides that the flag
parses in the pure core, so a bad value fails as a tagged 400 instead of a 500.

**Door:** two-way. The flag is optional, and old clients keep getting the same body.

## Verification

- `bun test apps/server/src/features/health`: `parseVerbose("maybe")` failed before the change
  (no `InvalidVerboseFlag` tag) and passes after it.
- `bun run check`: all gates passed.
- `bun run smoke`: 2 pass, including `GET /api/health?verbose=1`.

## Owning Agent Note

`.agents/notes/implemented/feature/2026-01-01-health-verbose-flag.md` (created in this change).
