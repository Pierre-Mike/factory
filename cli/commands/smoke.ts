/**
 * `axioms smoke`: prove the app runs on the real runtime. Builds the web app, applies the D1
 * migrations to a fresh local database, starts `wrangler dev`, waits for /api/health, then runs
 * apps/server/smoke/*.smoke.test.ts with SMOKE_URL pointing at it. Type checks and unit tests
 * cannot catch a worker that fails to boot or a migration that does not apply; this can.
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { run } from "../shell"

const PERSIST = ".wrangler/smoke"

const waitForHealth = async (url: string): Promise<boolean> => {
  const deadline = performance.now() + 60_000
  while (performance.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return true
    } catch {
      // not listening yet
    }
    await Bun.sleep(500)
  }
  return false
}

export const smoke = async (root: string): Promise<boolean> => {
  const server = join(root, "apps", "server")
  const env = { CI: "1", WRANGLER_SEND_METRICS: "false" }

  console.error("── build web ──")
  if ((await run({ cmd: ["bun", "run", "build"], cwd: join(root, "apps", "web") })) !== 0)
    return false

  console.error("── apply migrations (local) ──")
  await rm(join(server, PERSIST), { recursive: true, force: true })
  const migrate = await run({
    cmd: [
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      PERSIST,
    ],
    cwd: server,
    env,
  })
  if (migrate !== 0) return false

  const port = 8800 + Math.floor(Math.random() * 200)
  const url = `http://127.0.0.1:${port}`
  console.error(`── wrangler dev on ${url} ──`)
  const dev = Bun.spawn(
    [
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
    ],
    { cwd: server, env: { ...process.env, ...env }, stdout: "ignore", stderr: "inherit" },
  )
  try {
    if (!(await waitForHealth(url))) {
      console.error("✖ smoke: /api/health never answered 200 within 60s")
      return false
    }
    console.error("── smoke tests ──")
    const code = await run({
      cmd: ["bun", "test", "./smoke"],
      cwd: server,
      env: { SMOKE_URL: url },
    })
    console.error(code === 0 ? "✓ smoke: the app works on wrangler dev" : "✖ smoke tests failed")
    return code === 0
  } finally {
    dev.kill("SIGINT")
    await Promise.race([dev.exited, Bun.sleep(5_000)])
    if (dev.exitCode === null) dev.kill("SIGKILL")
  }
}
