# Test examples

Each example uses the project's idiom: `bun:test`, pure cores that take one options object,
failures as `Result` values. The shapes come from the template's `health` slice.

## Core: a literal from the requirement, not a recomputation

```ts
import { describe, expect, it } from "bun:test"
import { orderTotal } from "./checkout.core"

// Bad: the expected value is computed the way the code computes it, so the test can't fail.
it("sums the lines", () => {
  const lines = [{ cents: 1_000 }, { cents: 550 }]
  expect(orderTotal({ lines })).toBe(lines.reduce((sum, l) => sum + l.cents, 0))
})

// Good: the expected value comes from a worked example.
it("sums the lines", () => {
  expect(orderTotal({ lines: [{ cents: 1_000 }, { cents: 550 }] })).toBe(1_550)
})
```

## Core: assert the tag, not the message

```ts
import { Result } from "effect"

it("rejects a negative quantity", () => {
  const result = parseQuantity("-2")
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    // Good: callers branch on _tag, and STATUS_BY_TAG maps it to a status.
    expect(result.failure._tag).toBe("InvalidQuantity")
    // Bad: expect(result.failure.message).toBe("quantity must be >= 0"), which pins wording nobody reads
  }
})
```

## Core: a property that states a rule, not the algorithm

```ts
import * as fc from "fast-check"

// Good: an invariant the requirement promises.
it("never returns negative uptime", () => {
  fc.assert(
    fc.property(fc.integer(), fc.integer(), (startedAt, now) => {
      expect(buildStatus({ version: "x", startedAt, now }).uptimeMs).toBeGreaterThanOrEqual(0)
    }),
  )
})

// Bad: expect(buildStatus(input).uptimeMs).toBe(Math.max(0, input.now - input.startedAt)),
// which restates the implementation.
```

## Route: fake the io service, then drive the real route

```ts
import { decodeApiErrorBody } from "@app/shared"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HealthClock } from "./health.io"
import { buildHealthApp } from "./health.routes"

const FrozenClock = Layer.succeed(HealthClock, {
  now: () => Effect.succeed(5_000),
  startedAt: 2_000,
  version: "9.9.9",
})
const app = buildHealthApp(ManagedRuntime.make(FrozenClock))

it("maps an invalid flag to the shared 400 envelope", async () => {
  const res = await app.request("/?verbose=banana")
  expect(res.status).toBe(400)
  expect(decodeApiErrorBody(await res.json()).error._tag).toBe("InvalidVerboseFlag")
})
```

Bad versions of the same test:

- spying on `parseVerbose` to check that it was called, which is an internal call no user sees;
- asserting on the response text instead of decoding it with the shared contract.

## Route: verify through the interface, not a side channel

```ts
// Bad: reads the table directly, so the test breaks when the storage changes.
it("creates a note", async () => {
  await app.request("/", { method: "POST", body: JSON.stringify({ text: "hi" }) })
  expect(await sql.all("SELECT * FROM notes")).toHaveLength(1)
})

// Good: what the user can read back.
it("creates a note that can be read back", async () => {
  const created = await app.request("/", { method: "POST", body: JSON.stringify({ text: "hi" }) })
  const { id } = decodeNote(await created.json())
  const fetched = await app.request(`/${id}`)
  expect(decodeNote(await fetched.json()).text).toBe("hi")
})
```

## "It didn't happen" needs a case where it did

```ts
// Shown alone, the first test can't tell "never charges" from "the spy is not wired".
it("an empty cart never charges", async () => {
  const charges: number[] = []
  await runCheckout({ cart: [], payments: fakePayments(charges) })
  expect(charges).toEqual([])
})

it("a non-empty cart charges once", async () => {
  const charges: number[] = []
  await runCheckout({ cart: [{ cents: 500 }], payments: fakePayments(charges) })
  expect(charges).toEqual([500])
})
```
