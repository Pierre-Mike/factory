/**
 * Local servers for `smoke`, `dev` and `e2e`: a free port, the D1 migrations, `wrangler dev`, the
 * wait for /api/health, and the stop. Each server runs in its own process group, so stopping it
 * also stops what it spawned (wrangler's node process and workerd), and SIGINT or SIGTERM to the
 * CLI stops every server it started before it exits. No command leaves a workerd running.
 */
import type { Subprocess } from "bun"
import { migrationsCmd, wranglerDevCmd } from "../devserver.core"
import { run, type Sink, teeStream } from "../shell"

/** Keeps wrangler quiet and non-interactive. */
export const WRANGLER_ENV = { CI: "1", WRANGLER_SEND_METRICS: "false" }

/**
 * Ports nothing listens on right now: the OS picks each one, and all stay held until every one is
 * chosen, so the ports differ. They are released for the servers that are about to start.
 */
export const freePorts = (count: number): number[] => {
  const listeners = Array.from({ length: count }, () =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } }),
  )
  const ports = listeners.map((listener) => listener.port)
  for (const listener of listeners) listener.stop(true)
  return ports
}

export const applyMigrations = async (input: {
  readonly server: string
  readonly persistTo: string | undefined
  readonly sink: Sink | undefined
}): Promise<boolean> =>
  (await run({
    cmd: migrationsCmd({ persistTo: input.persistTo }),
    cwd: input.server,
    env: WRANGLER_ENV,
    sink: input.sink,
  })) === 0

export interface Service {
  readonly proc: Subprocess
  /** Its output, piped into a sink; resolves once the stream closes. */
  readonly log: Promise<void>
  /** SIGINT to the whole group, SIGKILL after 5s, then SIGKILL to anything left in it. */
  readonly stop: () => Promise<void>
}

const running = new Set<Service>()

const signalGroup = (input: { readonly pid: number; readonly signal: NodeJS.Signals | 0 }) => {
  try {
    process.kill(-input.pid, input.signal)
    return true
  } catch {
    // ESRCH: nothing is left in the group
    return false
  }
}

const stopService = async (proc: Subprocess): Promise<void> => {
  signalGroup({ pid: proc.pid, signal: "SIGINT" })
  await Promise.race([proc.exited, Bun.sleep(5_000)])
  // The leader can exit before its children; give them a moment, then sweep the group.
  const deadline = performance.now() + 2_000
  while (performance.now() < deadline && signalGroup({ pid: proc.pid, signal: 0 })) {
    await Bun.sleep(100)
  }
  signalGroup({ pid: proc.pid, signal: "SIGKILL" })
  await proc.exited
}

let trapped = false

/** Interrupted (Ctrl-C, a killed CI job): stop every running server, then exit. */
const trapSignals = () => {
  if (trapped) return
  trapped = true
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    process.on(signal, () => {
      console.error(`\n${signal}: stopping ${running.size} local server(s)`)
      void Promise.all([...running].map((service) => service.stop())).then(() => process.exit(code))
    })
  }
}

/**
 * Start a long-running command in its own process group. stdin is ignored: a process outside the
 * terminal's foreground group that reads the terminal would be stopped by SIGTTIN.
 */
export const startService = (input: {
  readonly cmd: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: Record<string, string>
  /** "inherit": stdout and stderr shown; "quiet": stderr only; a sink: stderr into it, teed to ours. */
  readonly output: "inherit" | "quiet" | Sink
}): Service => {
  trapSignals()
  const piped = typeof input.output === "function"
  const proc = Bun.spawn([...input.cmd], {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    detached: true,
    stdin: "ignore",
    stdout: input.output === "inherit" ? "inherit" : "ignore",
    stderr: piped ? "pipe" : "inherit",
  })
  const sink = input.output
  const log =
    typeof sink === "function" && proc.stderr instanceof ReadableStream
      ? teeStream({ stream: proc.stderr, sink })
      : Promise.resolve()
  let stopping: Promise<void> | undefined
  const service: Service = {
    proc,
    log,
    stop: () => {
      stopping ??= stopService(proc).then(async () => {
        running.delete(service)
        await log
      })
      return stopping
    },
  }
  running.add(service)
  return service
}

/**
 * `wrangler dev` for the worker in `server` (apps/server), on loopback. Take both ports from one
 * `freePorts` call, so the inspector cannot be handed the port just released for the server.
 */
export const startWrangler = (input: {
  readonly server: string
  readonly port: number
  readonly inspectorPort: number
  readonly persistTo: string | undefined
  readonly output: "inherit" | "quiet" | Sink
}): Service =>
  startService({
    cmd: wranglerDevCmd({
      port: input.port,
      inspectorPort: input.inspectorPort,
      persistTo: input.persistTo,
    }),
    cwd: input.server,
    env: WRANGLER_ENV,
    output: input.output,
  })

/** Poll /api/health for up to 60s, giving up as soon as the server has exited. */
export const waitForHealth = async (input: {
  readonly url: string
  readonly alive: () => boolean
}): Promise<boolean> => {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline && input.alive()) {
    try {
      const res = await fetch(`${input.url}/api/health`)
      if (res.ok) return true
    } catch {
      // not listening yet
    }
    await Bun.sleep(500)
  }
  return false
}
