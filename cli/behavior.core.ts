/**
 * The behavior pass of `axioms smoke`, pure. After the project's own smoke tests, the shell lists
 * the routes of the built Hono app (`buildApp(...).routes`, the value `AppType` is the type of),
 * sends every write route a malformed JSON body and a 1 MB body over real HTTP, and hands the
 * answers to this module: which routes to probe, what each answer means, and which routes broke a
 * rule. The rules are the ones that separated apps in the A/B eval (issue #15): a bad body never
 * causes a 5xx, a refusal is a 4xx with the shared `ApiErrorBody` envelope, no body leaks a stack
 * frame or SQL, and once the app has sessions, every write route not listed in
 * `apps/server/public-routes.json` refuses a request without one.
 */

export interface Route {
  readonly method: string
  readonly path: string
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"]

/** The write routes of a Hono `routes` list, each once, in mount order. */
export const writeRoutes = (routes: ReadonlyArray<Route>): Route[] => {
  const seen = new Set<string>()
  const result: Route[] = []
  for (const { method, path } of routes) {
    const key = `${method} ${path}`
    if (!WRITE_METHODS.includes(method) || seen.has(key)) continue
    seen.add(key)
    result.push({ method, path })
  }
  return result
}

/** `:name`, `:name?` and `:name{regex}` (one level of nested braces), or a `*` wildcard. */
const PARAM = /:\w+(\{(?:[^{}]|\{[^{}]*\})*\})?\??|\*/g

/**
 * A concrete path for a route pattern: every parameter becomes `1`, which fits the common
 * patterns (an id, a slug, a digits-only regex). A path the router still does not match answers
 * the 404 envelope, which the verdicts accept; the pass then tested the edge, not the handler.
 */
export const probePath = (pattern: string): string => pattern.replace(PARAM, "1")

export interface Probe {
  readonly name: string
  readonly body: string
  /**
   * A route that takes no body (`POST /logout`, `DELETE /items/:id`) never parses it, so a 2xx or
   * 3xx answer is correct. Only the malformed-JSON probe allows that: `bodyLimit` refuses the
   * 1 MB body before any route runs.
   */
  readonly ignorable: boolean
}

const MB = 1024 * 1024

/**
 * What every write route is sent, with `content-type: application/json` and no session. The 1 MB
 * body is well-formed JSON, so it tests the size limit rather than the parser.
 */
export const MALFORMED_JSON: Probe = { name: "malformed JSON", body: "{bad json", ignorable: true }

export const PROBES: ReadonlyArray<Probe> = [
  MALFORMED_JSON,
  { name: "1 MB body", body: JSON.stringify({ pad: "a".repeat(MB) }), ignorable: false },
]

const isEnvelope = (body: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== "object" || parsed === null) return false
    const { ok, error } = parsed as { ok?: unknown; error?: unknown }
    return (
      ok === false &&
      typeof error === "object" &&
      error !== null &&
      typeof (error as { _tag?: unknown })._tag === "string"
    )
  } catch {
    return false
  }
}

/**
 * What is wrong with the answer to one probe. A 4xx must carry the shared envelope. A 5xx always
 * fails. A 2xx or 3xx passes only for a probe the route may ignore. No body may leak.
 */
export const probeProblems = (answer: {
  readonly probe: Probe
  readonly status: number
  readonly body: string
}): string[] => {
  const { probe, status, body } = answer
  const refused = status >= 400 && status < 500
  const ignored = probe.ignorable && status >= 200 && status < 400
  const expected = probe.ignorable ? "a 4xx or a route that ignores the body" : "a 4xx"
  return [
    ...(refused || ignored ? [] : [`answered ${status}, expected ${expected}`]),
    ...(ignored || isEnvelope(body)
      ? []
      : ["the body is not the ApiErrorBody envelope { ok: false, error: { _tag } }"]),
    ...findLeaks(body).map((leak) => `the body leaks ${leak}`),
  ]
}

/** Where a project lists the write routes that need no session, relative to the project root. */
export const PUBLIC_ROUTES_FILE = "apps/server/public-routes.json"

export interface PublicRoute {
  /** `<METHOD> <path>` as Hono mounts it, e.g. `POST /api/login`. */
  readonly route: string
  /** The Agent Note that records why the route is public, relative to the project root. */
  readonly note: string
}

const PUBLIC_ROUTES_SHAPE = `${PUBLIC_ROUTES_FILE} must be one JSON object of "<METHOD> <path>": "<Agent Note path>" entries, the note under .agents/notes/`
const ROUTE_KEY = /^(?:POST|PUT|PATCH|DELETE) \/\S*$/
const NOTE_PATH = /^\.agents\/notes\/\S+\.md$/

export const parsePublicRoutes = (
  text: string,
):
  | { readonly ok: true; readonly entries: ReadonlyArray<PublicRoute> }
  | { readonly ok: false; readonly error: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `${PUBLIC_ROUTES_SHAPE} (${String(error)})` }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: PUBLIC_ROUTES_SHAPE }
  }
  const entries = Object.entries(parsed)
  const bad = entries.find(
    ([route, note]) => !ROUTE_KEY.test(route) || typeof note !== "string" || !NOTE_PATH.test(note),
  )
  if (bad !== undefined)
    return { ok: false, error: `${PUBLIC_ROUTES_SHAPE} (bad entry "${bad[0]}")` }
  return { ok: true, entries: entries.map(([route, note]) => ({ route, note: String(note) })) }
}

/**
 * Each public route must be a write route the app has, and its note must exist and name it, so the
 * reason for the opt-out is one search away. `notes` holds the text of each note that exists.
 */
export const publicRouteProblems = (input: {
  readonly entries: ReadonlyArray<PublicRoute>
  readonly routes: ReadonlyArray<Route>
  readonly notes: Readonly<Record<string, string>>
}): string[] => {
  const known = new Set(input.routes.map(routeName))
  return input.entries.flatMap(({ route, note }) => {
    const text = Object.hasOwn(input.notes, note) ? input.notes[note] : undefined
    return [
      ...(known.has(route) ? [] : [`${route}: the app has no such write route`]),
      ...(text === undefined
        ? [`${route}: ${note} does not exist`]
        : text.includes(route)
          ? []
          : [`${route}: ${note} does not mention "${route}"`]),
    ]
  })
}

export const routeName = (route: Route): string => `${route.method} ${route.path}`

const asksForSession = (status: number): boolean => status === 401 || status === 403

/**
 * Write routes refuse a request without a session. The template has no auth, so the check turns
 * itself on: once any write route answers the malformed-JSON probe (sent without a session) with
 * 401 or 403, the app has sessions, and every other write route not listed as public must do the
 * same. That also pins the order: a route checks the session before it reads the body.
 */
export const sessionCheck = (input: {
  /** Each write route with the status it answered to the malformed-JSON probe. */
  readonly answers: ReadonlyArray<{ readonly route: Route; readonly status: number }>
  /** `<METHOD> <path>` of each route listed in the public routes file. */
  readonly publicRoutes: ReadonlyArray<string>
}): { readonly active: boolean; readonly problems: string[] } => {
  const witness = input.answers.find(({ status }) => asksForSession(status))
  if (witness === undefined) return { active: false, problems: [] }
  const problems = input.answers
    .filter(
      ({ route, status }) =>
        !asksForSession(status) && !input.publicRoutes.includes(routeName(route)),
    )
    .map(
      ({ route, status }) =>
        `${routeName(route)}: answered ${status} without a session, but ${routeName(witness.route)} asks for one. Check the session before reading the body, or list the route in ${PUBLIC_ROUTES_FILE}`,
    )
  return { active: true, problems }
}

/** A V8 stack frame: `at fn (file:line:col)` or `at file:line:col`. */
const STACK_FRAME = /\bat (?:async )?(?:[^\s()]+ \()?[^\s()"]+:\d+:\d+/

/**
 * SQL statements and database error text. Keywords are upper case only, so prose such as "select
 * one from the list" passes; the error texts are the ones D1 and SQLite put in a message.
 */
const SQL = [
  /\bSELECT\b[^"]*?\bFROM\b/,
  /\bINSERT INTO\b/,
  /\bUPDATE \w+ SET\b/,
  /\bDELETE FROM\b/,
  /\b(?:CREATE|DROP|ALTER) TABLE\b/,
  /\bD1_ERROR\b/,
  /\bno such (?:table|column)\b/,
  /\bSQLITE_[A-Z]+\b/,
]

/** What a response body leaks: one entry per kind of leak, with the text that matched. */
export const findLeaks = (body: string): string[] => {
  const frame = body.match(STACK_FRAME)
  const sql = SQL.map((pattern) => body.match(pattern)?.[0]).filter((m) => m !== undefined)
  return [
    ...(frame === null ? [] : [`a stack frame (${frame[0]})`]),
    ...sql.map((match) => `SQL (${match})`),
  ]
}
