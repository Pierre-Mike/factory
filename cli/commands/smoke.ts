/**
 * `axioms smoke`: prove the app runs on the real runtime. Builds the web app, applies the D1
 * migrations to a fresh local database, starts `wrangler dev`, waits for /api/health, then runs
 * apps/server/smoke/*.smoke.test.ts with SMOKE_URL pointing at it, then the behavior pass
 * (commands/behavior.ts) over every write route. Type checks and unit tests cannot catch a worker
 * that fails to boot or a migration that does not apply; this can.
 * Each phase is a gate, so `--json` / `--report` get per-phase evidence; phases depend on one
 * another, so the run stops at the first failure.
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { Subprocess } from "bun"
import { run, type Sink, teeStream } from "../shell"
import { behavior } from "./behavior"
import { failedNames, type Gate, type GateRun, runGates } from "./gates"

const PERSIST = ".wrangler/smoke"

/** Poll /api/health for up to 60s, giving up as soon as wrangler dev has exited. */
const waitForHealth = async (input: {
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

export const smoke = async (input: {
  readonly root: string
  readonly collect: boolean
}): Promise<GateRun> => {
  const server = join(input.root, "apps", "server")
  const env = { CI: "1", WRANGLER_SEND_METRICS: "false" }
  const port = 8800 + Math.floor(Math.random() * 200)
  const url = `http://127.0.0.1:${port}`
  let dev: Subprocess | undefined
  let devLog: Promise<void> | undefined

  const spawnDev = (sink: Sink | undefined): Subprocess => {
    const cmd = [
      "bunx",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      PERSIST,
      "--var",
      "ENVIRONMENT:development",
    ]
    const shared = { cwd: server, env: { ...process.env, ...env } }
    if (sink === undefined) {
      return Bun.spawn(cmd, { ...shared, stdout: "ignore" as const, stderr: "inherit" as const })
    }
    const proc = Bun.spawn(cmd, { ...shared, stdout: "ignore" as const, stderr: "pipe" as const })
    devLog = teeStream({ stream: proc.stderr, sink })
    return proc
  }

  const gates: ReadonlyArray<Gate> = [
    [
      "build web",
      async (sink) =>
        (await run({
          cmd: ["bun", "run", "build"],
          cwd: join(input.root, "apps", "web"),
          sink,
        })) === 0,
    ],
    [
      "migrations",
      async (sink) => {
        await rm(join(server, PERSIST), { recursive: true, force: true })
        const cmd = ["bunx", "wrangler", "d1", "migrations", "apply", "DB", "--local"]
        return (await run({ cmd: [...cmd, "--persist-to", PERSIST], cwd: server, env, sink })) === 0
      },
    ],
    [
      "wrangler dev",
      async (sink) => {
        console.error(`wrangler dev on ${url}`)
        const proc = spawnDev(sink)
        dev = proc
        if (await waitForHealth({ url, alive: () => proc.exitCode === null })) return true
        console.error(
          proc.exitCode === null
            ? "✖ smoke: /api/health never answered 200 within 60s"
            : `✖ smoke: wrangler dev exited (code ${proc.exitCode}) before /api/health answered`,
        )
        return false
      },
    ],
    [
      "smoke tests",
      async (sink) =>
        (await run({
          cmd: ["bun", "test", "./smoke"],
          cwd: server,
          env: { SMOKE_URL: url },
          sink,
        })) === 0,
    ],
    ["behavior", () => behavior({ root: input.root, url })],
  ]

  try {
    const result = await runGates({ gates, collect: input.collect, stopOnFailure: true })
    console.error(
      result.ok
        ? "✓ smoke: the app works on wrangler dev"
        : `✖ smoke failed: ${failedNames(result)}`,
    )
    return result
  } finally {
    const proc = dev
    if (proc !== undefined) {
      proc.kill("SIGINT")
      await Promise.race([proc.exited, Bun.sleep(5_000)])
      if (proc.exitCode === null) proc.kill("SIGKILL")
    }
    await devLog
  }
}
