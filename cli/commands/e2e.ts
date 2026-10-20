/**
 * `axioms e2e`: the saved browser tests, against the app as a user gets it. Builds the web app,
 * installs Playwright's headless chromium (a no-op once cached), applies the D1 migrations to a
 * throwaway directory, starts `wrangler dev` on a free port, then runs apps/web/e2e/*.e2e.ts with
 * E2E_URL pointing at it. The server is always stopped: when a test fails, when a phase crashes,
 * and on SIGINT or SIGTERM (see devserver.ts). Each phase is a gate, so `--json` / `--report` get
 * per-phase evidence; phases depend on one another, so the run stops at the first failure.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { localUrl } from "../devserver.core"
import { harnessProfile } from "../doctor.core"
import { BROWSER_INSTALL_CMD, E2E_DIR, e2eTestCmd, e2eTestFiles } from "../e2e.core"
import { readJson, run } from "../shell"
import { applyMigrations, freePorts, type Service, startWrangler, waitForHealth } from "./devserver"
import { failedNames, type Gate, type GateRun, runGates } from "./gates"

const listTests = async (dir: string): Promise<string[]> => {
  try {
    return e2eTestFiles(await readdir(dir))
  } catch {
    return []
  }
}

export const e2e = async (input: {
  readonly root: string
  readonly collect: boolean
}): Promise<GateRun> => {
  // An adopted (lite) repo has no web app; the shared pre-push hook still calls this command.
  if (harnessProfile(readJson(join(input.root, "package.json"))) === "lite") {
    console.error("✓ e2e: skipped, a lite project has no web app")
    return { ok: true, gates: [] }
  }
  const server = join(input.root, "apps", "server")
  const web = join(input.root, "apps", "web")
  const [port = 0, inspectorPort = 0] = freePorts(2)
  const url = localUrl(port)
  let persistTo: string | undefined
  let dev: Service | undefined
  let tests: string[] = []

  const gates: ReadonlyArray<Gate> = [
    [
      "find tests",
      async () => {
        tests = await listTests(join(web, E2E_DIR))
        if (tests.length > 0) {
          console.error(`${tests.length} browser test file(s): ${tests.join(", ")}`)
          return true
        }
        console.error(
          `✖ e2e: no apps/web/${E2E_DIR}/*.e2e.ts; add one for each user-visible feature`,
        )
        return false
      },
    ],
    [
      "build web",
      async (sink) => (await run({ cmd: ["bun", "run", "build"], cwd: web, sink })) === 0,
    ],
    ["browser", async (sink) => (await run({ cmd: BROWSER_INSTALL_CMD, cwd: web, sink })) === 0],
    [
      "migrations",
      async (sink) => {
        persistTo = await mkdtemp(join(tmpdir(), "axioms-e2e-"))
        return applyMigrations({ server, persistTo, sink })
      },
    ],
    [
      "wrangler dev",
      async (sink) => {
        console.error(`wrangler dev on ${url}, D1 state in ${persistTo}`)
        dev = startWrangler({ server, port, inspectorPort, persistTo, output: sink ?? "quiet" })
        const proc = dev.proc
        if (await waitForHealth({ url, alive: () => proc.exitCode === null })) return true
        console.error(
          proc.exitCode === null
            ? "✖ e2e: /api/health never answered 200 within 60s"
            : `✖ e2e: wrangler dev exited (code ${proc.exitCode}) before /api/health answered`,
        )
        return false
      },
    ],
    [
      "e2e tests",
      async (sink) =>
        (await run({ cmd: e2eTestCmd(tests), cwd: web, env: { E2E_URL: url }, sink })) === 0,
    ],
  ]

  try {
    const result = await runGates({ gates, collect: input.collect, stopOnFailure: true })
    console.error(
      result.ok
        ? "✓ e2e: the browser tests pass against wrangler dev"
        : `✖ e2e failed: ${failedNames(result)}`,
    )
    return result
  } finally {
    await dev?.stop()
    if (persistTo !== undefined) await rm(persistTo, { recursive: true, force: true })
  }
}
