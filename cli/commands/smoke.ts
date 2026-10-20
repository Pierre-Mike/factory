/**
 * `axioms smoke`: prove the app runs on the real runtime. Builds the web app, applies the D1
 * migrations to a fresh local database, starts `wrangler dev`, waits for /api/health, then runs
 * apps/server/smoke/*.smoke.test.ts with SMOKE_URL pointing at it. Type checks and unit tests
 * cannot catch a worker that fails to boot or a migration that does not apply; this can.
 * Each phase is a gate, so `--json` / `--report` get per-phase evidence; phases depend on one
 * another, so the run stops at the first failure.
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { localUrl } from "../devserver.core"
import { run } from "../shell"
import { applyMigrations, freePorts, type Service, startWrangler, waitForHealth } from "./devserver"
import { failedNames, type Gate, type GateRun, runGates } from "./gates"

const PERSIST = ".wrangler/smoke"

export const smoke = async (input: {
  readonly root: string
  readonly collect: boolean
}): Promise<GateRun> => {
  const server = join(input.root, "apps", "server")
  const [port = 0, inspectorPort = 0] = freePorts(2)
  const url = localUrl(port)
  let dev: Service | undefined

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
        return applyMigrations({ server, persistTo: PERSIST, sink })
      },
    ],
    [
      "wrangler dev",
      async (sink) => {
        console.error(`wrangler dev on ${url}`)
        dev = startWrangler({
          server,
          port,
          inspectorPort,
          persistTo: PERSIST,
          output: sink ?? "quiet",
        })
        const proc = dev.proc
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
    await dev?.stop()
  }
}
