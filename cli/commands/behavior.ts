/**
 * The behavior gate of `axioms smoke`: runs after the project's smoke tests, against the same
 * `wrangler dev`. It lists the write routes of the built app, sends each the probes of
 * behavior.core.ts over real HTTP, and fails naming every route that broke a rule.
 *
 * The routes come from the app itself: a Bun child imports apps/server/src/api.ts and prints
 * `buildApp(undefined).routes`. `AppType` is `ReturnType<typeof buildApp>`, so this is the route
 * list `AppType` describes, with the `/api` base path and every slice mount already applied.
 * Building the app only wires handlers, so it needs no runtime.
 */
import { join } from "node:path"
import {
  MALFORMED_JSON,
  PROBES,
  PUBLIC_ROUTES_FILE,
  parsePublicRoutes,
  probePath,
  probeProblems,
  publicRouteProblems,
  type Route,
  routeName,
  sessionCheck,
  writeRoutes,
} from "../behavior.core"
import { readText } from "../shell"

const listRoutes = async (input: { readonly server: string }): Promise<ReadonlyArray<Route>> => {
  const api = JSON.stringify(join(input.server, "src", "api.ts"))
  const script = `const { buildApp } = await import(${api})
const routes = buildApp(undefined).routes.map(({ method, path }) => ({ method, path }))
process.stdout.write("\\n" + JSON.stringify(routes))`
  const proc = Bun.spawn(["bun", "--eval", script], {
    cwd: input.server,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`could not list the app's routes from src/api.ts:\n${err}`)
  // The last line only: a module may log while it loads.
  return JSON.parse(out.trim().split("\n").at(-1) ?? "[]") as ReadonlyArray<Route>
}

const send = async (input: {
  readonly url: string
  readonly route: Route
  readonly body: string
}): Promise<{ readonly status: number; readonly body: string }> => {
  const res = await fetch(`${input.url}${probePath(input.route.path)}`, {
    method: input.route.method,
    headers: { "content-type": "application/json" },
    body: input.body,
  })
  return { status: res.status, body: await res.text() }
}

/** The public routes file, or no entries when the project has none. */
const readPublicRoutes = (input: { readonly root: string }) => {
  const text = readText(join(input.root, PUBLIC_ROUTES_FILE))
  return text === null ? { ok: true as const, entries: [] } : parsePublicRoutes(text)
}

export const behavior = async (input: {
  readonly root: string
  readonly url: string
}): Promise<boolean> => {
  const routes = writeRoutes(await listRoutes({ server: join(input.root, "apps", "server") }))
  const listed = readPublicRoutes({ root: input.root })
  if (!listed.ok) {
    console.error(`✖ ${listed.error}`)
    return false
  }
  const notes = Object.fromEntries(
    listed.entries.flatMap(({ note }) => {
      const text = readText(join(input.root, note))
      return text === null ? [] : [[note, text]]
    }),
  )
  const problems = publicRouteProblems({ entries: listed.entries, routes, notes })
  const malformed: { route: Route; status: number }[] = []
  for (const route of routes) {
    for (const probe of PROBES) {
      const answer = await send({ url: input.url, route, body: probe.body })
      if (probe === MALFORMED_JSON) malformed.push({ route, status: answer.status })
      for (const problem of probeProblems({ probe, ...answer })) {
        problems.push(`${routeName(route)} (${probe.name}): ${problem}`)
      }
    }
  }
  const sessions = sessionCheck({
    answers: malformed,
    publicRoutes: listed.entries.map(({ route }) => route),
  })
  problems.push(...sessions.problems)

  for (const problem of problems) console.error(`✖ ${problem}`)
  if (problems.length > 0) return false
  console.error(
    `✓ behavior: ${routes.length} write route(s) take bad bodies without a 5xx and leak nothing; ${
      sessions.active
        ? "every non-public write route asks for a session"
        : "no write route asks for a session yet, so the session check is off"
    }`,
  )
  return true
}
