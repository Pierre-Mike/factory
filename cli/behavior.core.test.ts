import { describe, expect, it } from "bun:test"
import {
  findLeaks,
  PROBES,
  type Probe,
  parsePublicRoutes,
  probePath,
  probeProblems,
  publicRouteProblems,
  sessionCheck,
  writeRoutes,
} from "./behavior.core"

describe("sessionCheck", () => {
  const login = { method: "POST", path: "/api/login" }
  const widgets = { method: "POST", path: "/api/widgets/:id" }
  const gadgets = { method: "DELETE", path: "/api/gadgets/:id" }

  it("stays off while no write route asks for a session, as in a fresh project", () => {
    const answers = [
      { route: login, status: 400 },
      { route: widgets, status: 400 },
    ]
    expect(sessionCheck({ answers, publicRoutes: [] })).toEqual({ active: false, problems: [] })
  })

  it("once one route answers 401 or 403, fails every other write route not listed as public", () => {
    const answers = [
      { route: login, status: 400 },
      { route: widgets, status: 401 },
      { route: gadgets, status: 400 },
    ]
    expect(sessionCheck({ answers, publicRoutes: ["POST /api/login"] })).toEqual({
      active: true,
      problems: [
        "DELETE /api/gadgets/:id: answered 400 without a session, but POST /api/widgets/:id asks for one. Check the session before reading the body, or list the route in apps/server/public-routes.json",
      ],
    })
    expect(
      sessionCheck({
        answers: [...answers.slice(0, 2), { route: gadgets, status: 403 }],
        publicRoutes: ["POST /api/login"],
      }),
    ).toEqual({ active: true, problems: [] })
  })
})

const LOGIN_NOTE = ".agents/notes/implemented/feature/2026-11-02-login.md"

describe("parsePublicRoutes", () => {
  it("reads a map of route to the Agent Note that says why it is public", () => {
    expect(parsePublicRoutes(`{ "POST /api/login": "${LOGIN_NOTE}" }`)).toEqual({
      ok: true,
      entries: [{ route: "POST /api/login", note: LOGIN_NOTE }],
    })
  })

  it("rejects anything else, naming the expected shape", () => {
    const notANote = '{ "POST /api/login": "docs/why.md" }'
    for (const text of [
      "[]",
      "{",
      '{ "POST /api/login": 1 }',
      '{ "/api/login": "x.md" }',
      notANote,
    ]) {
      const parsed = parsePublicRoutes(text)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toContain('"<METHOD> <path>": "<Agent Note path>"')
    }
  })
})

describe("publicRouteProblems", () => {
  const routes = [{ method: "POST", path: "/api/login" }]
  const entries = [{ route: "POST /api/login", note: LOGIN_NOTE }]

  it("accepts an entry whose note exists and names the route", () => {
    const notes = { [LOGIN_NOTE]: "The login form posts to `POST /api/login` without a session." }
    expect(publicRouteProblems({ entries, routes, notes })).toEqual([])
  })

  it("rejects a route the app does not have, a missing note, and a note that does not name it", () => {
    expect(
      publicRouteProblems({
        entries: [...entries, { route: "DELETE /api/gone", note: LOGIN_NOTE }],
        routes,
        notes: { [LOGIN_NOTE]: "Nothing about the route." },
      }),
    ).toEqual([
      `POST /api/login: ${LOGIN_NOTE} does not mention "POST /api/login"`,
      "DELETE /api/gone: the app has no such write route",
      `DELETE /api/gone: ${LOGIN_NOTE} does not mention "DELETE /api/gone"`,
    ])
    expect(publicRouteProblems({ entries, routes, notes: {} })).toEqual([
      `POST /api/login: ${LOGIN_NOTE} does not exist`,
    ])
  })
})

describe("PROBES", () => {
  it("sends malformed JSON, and a well-formed body of at least 1 MB", () => {
    const [malformed, large] = PROBES
    expect(() => JSON.parse(malformed?.body ?? "")).toThrow()
    expect(large?.body.length).toBeGreaterThanOrEqual(1024 * 1024)
    expect(() => JSON.parse(large?.body ?? "")).not.toThrow()
  })
})

describe("probeProblems", () => {
  const envelope = (tag: string) => JSON.stringify({ ok: false, error: { _tag: tag } })
  const [malformed, large] = PROBES as [Probe, Probe]

  it("accepts a 4xx with the shared envelope", () => {
    expect(probeProblems({ probe: malformed, status: 400, body: envelope("BadRequest") })).toEqual(
      [],
    )
    expect(probeProblems({ probe: large, status: 413, body: envelope("PayloadTooLarge") })).toEqual(
      [],
    )
  })

  it("accepts a route that ignores the body answering malformed JSON with 2xx", () => {
    expect(probeProblems({ probe: malformed, status: 200, body: '{"ok":true}' })).toEqual([])
    expect(probeProblems({ probe: malformed, status: 204, body: "" })).toEqual([])
  })

  it("rejects a 1 MB body that is not refused with a 4xx", () => {
    expect(probeProblems({ probe: large, status: 200, body: '{"ok":true}' })).toEqual([
      "answered 200, expected a 4xx",
      "the body is not the ApiErrorBody envelope { ok: false, error: { _tag } }",
    ])
  })

  it("rejects a 5xx on either probe", () => {
    const body = envelope("InternalServerError")
    expect(probeProblems({ probe: malformed, status: 500, body })).toEqual([
      "answered 500, expected a 4xx or a route that ignores the body",
    ])
    expect(probeProblems({ probe: large, status: 500, body })).toEqual([
      "answered 500, expected a 4xx",
    ])
  })

  it("rejects a 4xx that is not the envelope", () => {
    const problem = "the body is not the ApiErrorBody envelope { ok: false, error: { _tag } }"
    expect(probeProblems({ probe: large, status: 413, body: "Payload Too Large" })).toEqual([
      problem,
    ])
    expect(
      probeProblems({ probe: malformed, status: 400, body: '{"ok":false,"error":"bad"}' }),
    ).toEqual([problem])
  })

  it("names what the body leaks, on a 2xx too", () => {
    const body = JSON.stringify({
      ok: false,
      error: { _tag: "BadRequest", stack: "at f (/a.ts:1:2)" },
    })
    expect(probeProblems({ probe: malformed, status: 400, body })).toEqual([
      "the body leaks a stack frame (at f (/a.ts:1:2)",
    ])
    expect(probeProblems({ probe: malformed, status: 200, body: '"SELECT id FROM t"' })).toEqual([
      "the body leaks SQL (SELECT id FROM)",
    ])
  })
})

describe("findLeaks", () => {
  it("finds a stack frame, also inside a JSON string", () => {
    const body = JSON.stringify({
      error: "SyntaxError: bad\n    at parse (/app/src/widgets.routes.ts:12:7)",
    })
    expect(findLeaks(body)).toEqual(["a stack frame (at parse (/app/src/widgets.routes.ts:12:7)"])
    expect(findLeaks("at async file:///w/index.js:3:14")).toEqual([
      "a stack frame (at async file:///w/index.js:3:14)",
    ])
  })

  it("finds SQL statements and database error text", () => {
    expect(findLeaks('{"q":"SELECT id FROM widgets WHERE id = ?"}')).toEqual([
      "SQL (SELECT id FROM)",
    ])
    expect(findLeaks("D1_ERROR: no such table: widgets: SQLITE_ERROR")).toEqual([
      "SQL (D1_ERROR)",
      "SQL (no such table)",
      "SQL (SQLITE_ERROR)",
    ])
    expect(findLeaks("INSERT INTO widgets")).toEqual(["SQL (INSERT INTO)"])
  })

  it("passes the shared envelope and ordinary prose", () => {
    expect(findLeaks('{"ok":false,"error":{"_tag":"BadRequest"}}')).toEqual([])
    expect(findLeaks("look at the docs, then select one from the list and update the set")).toEqual(
      [],
    )
  })
})

describe("probePath", () => {
  it("fills every parameter, optional and regex-constrained ones too, and wildcards", () => {
    expect(probePath("/api/widgets/:id")).toBe("/api/widgets/1")
    expect(probePath("/api/a/:id{[0-9]+}/b/:slug?")).toBe("/api/a/1/b/1")
    expect(probePath("/api/files/*")).toBe("/api/files/1")
    expect(probePath("/api/health")).toBe("/api/health")
  })
})

describe("writeRoutes", () => {
  it("keeps POST, PUT, PATCH and DELETE once each, and drops reads and middleware", () => {
    const routes = [
      { method: "ALL", path: "/api/*" },
      { method: "GET", path: "/api/health" },
      // A route with a validator registers one entry per handler.
      { method: "POST", path: "/api/widgets/:id" },
      { method: "POST", path: "/api/widgets/:id" },
      { method: "PUT", path: "/api/widgets/:id" },
      { method: "PATCH", path: "/api/widgets/:id" },
      { method: "DELETE", path: "/api/widgets/:id" },
    ]
    expect(writeRoutes(routes)).toEqual([
      { method: "POST", path: "/api/widgets/:id" },
      { method: "PUT", path: "/api/widgets/:id" },
      { method: "PATCH", path: "/api/widgets/:id" },
      { method: "DELETE", path: "/api/widgets/:id" },
    ])
  })
})
