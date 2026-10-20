/**
 * Local servers, pure: the `axioms dev` arguments, which ports dev uses, and the wrangler commands
 * that `smoke`, `dev` and `e2e` all run through commands/devserver.ts. One place builds them, so
 * the three cannot drift apart on how the worker starts or where its D1 state lives.
 */

export const DEV_USAGE = "usage: axioms dev [--port <n>] [--persist-to <dir>]"

/** The ports `axioms dev` keeps when no `--port` is given: vite on 5173, wrangler dev on 8787. */
export const DEFAULT_PORTS = { web: 5173, api: 8787 } as const

export type DevArgs =
  | { readonly ok: true; readonly port: number | undefined; readonly persistTo: string | undefined }
  | { readonly ok: false; readonly error: string }

const PORT = /^(0|[1-9]\d{0,4})$/

const refuse = (problem: string): DevArgs => ({ ok: false, error: `${problem}\n${DEV_USAGE}` })

export const parseDevArgs = (args: ReadonlyArray<string>): DevArgs => {
  const values = new Map<string, string>()
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i] ?? ""
    const value = args[i + 1]
    if (flag !== "--port" && flag !== "--persist-to") return refuse(`unexpected argument ${flag}`)
    if (values.has(flag)) return refuse(`${flag} given twice`)
    if (value === undefined || value.startsWith("--")) return refuse(`${flag} needs a value`)
    values.set(flag, value)
  }
  const port = values.get("--port")
  if (port !== undefined && !(PORT.test(port) && Number(port) <= 65535)) {
    return refuse(`--port must be a whole number from 0 to 65535 (got "${port}")`)
  }
  return {
    ok: true,
    port: port === undefined ? undefined : Number(port),
    persistTo: values.get("--persist-to"),
  }
}

/**
 * The app's URL is vite's port, which proxies /api to wrangler dev. Without `--port` both keep
 * their fixed ports. With one, the app takes it (port 0: the first free port) and wrangler takes
 * the second free port, so two runs side by side never ask for the same wrangler port.
 */
export const devPorts = (input: {
  readonly requested: number | undefined
  readonly free: readonly [number, number]
}): { readonly web: number; readonly api: number } =>
  input.requested === undefined
    ? DEFAULT_PORTS
    : { web: input.requested === 0 ? input.free[0] : input.requested, api: input.free[1] }

export const localUrl = (port: number): string => `http://127.0.0.1:${port}`

const persist = (persistTo: string | undefined): string[] =>
  persistTo === undefined ? [] : ["--persist-to", persistTo]

/**
 * `wrangler dev` on loopback; without a persist directory it uses wrangler's default state. The
 * devtools inspector gets its own port too: wrangler otherwise tries 9229, and two servers that
 * start at the same moment both find it free and one fails with "Address already in use".
 */
export const wranglerDevCmd = (input: {
  readonly port: number
  readonly inspectorPort: number
  readonly persistTo: string | undefined
}): string[] => [
  "bunx",
  "wrangler",
  "dev",
  "--local",
  "--ip",
  "127.0.0.1",
  "--port",
  String(input.port),
  "--inspector-port",
  String(input.inspectorPort),
  ...persist(input.persistTo),
  "--var",
  "ENVIRONMENT:development",
]

export const migrationsCmd = (input: { readonly persistTo: string | undefined }): string[] => [
  "bunx",
  "wrangler",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  ...persist(input.persistTo),
]
