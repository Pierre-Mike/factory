/**
 * `axioms deploy [--dry-run]`.
 *
 * --dry-run builds the web app, bundles the worker exactly as `wrangler deploy` would (without
 * uploading), and applies every migration to a fresh local D1. It needs no Cloudflare account, so
 * it runs on every PR. Placeholders that would block a real deploy are reported, not fatal: a new
 * project has them until its first deploy.
 *
 * Without --dry-run it refuses while any blocker remains, runs the dry run, then applies the
 * migrations remotely and deploys.
 */
import { readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { deployBlockers } from "../deploy.core"
import { readText, run } from "../shell"

const OUT = ".wrangler/deploy-dry-run"
const ENV = { CI: "1", WRANGLER_SEND_METRICS: "false" }

const readWrangler = (server: string): unknown => {
  const path = join(server, "wrangler.jsonc")
  const text = readText(path)
  if (text === null) return null
  const parsed = ts.parseConfigFileTextToJson(path, text)
  return parsed.error === undefined ? parsed.config : null
}

const bundleKb = (dir: string): number =>
  readdirSync(dir)
    .filter((file) => file.endsWith(".js"))
    .reduce((total, file) => total + statSync(join(dir, file)).size, 0) / 1024

const dryRun = async (root: string): Promise<boolean> => {
  const server = join(root, "apps", "server")
  console.error("── build web ──")
  if ((await run({ cmd: ["bun", "run", "build"], cwd: join(root, "apps", "web") })) !== 0)
    return false

  console.error("── bundle worker (wrangler deploy --dry-run) ──")
  rmSync(join(server, OUT), { recursive: true, force: true })
  const bundled = await run({
    cmd: ["bunx", "wrangler", "deploy", "--dry-run", "--outdir", OUT],
    cwd: server,
    env: ENV,
  })
  if (bundled !== 0) return false
  console.error(`worker bundle: ${bundleKb(join(server, OUT)).toFixed(0)} KiB (uncompressed)`)

  console.error("── migrations on a fresh local D1 ──")
  const migrated = await run({
    cmd: [
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      `${OUT}/d1`,
    ],
    cwd: server,
    env: ENV,
  })
  return migrated === 0
}

export const deploy = async (input: { readonly root: string; readonly dryRun: boolean }) => {
  const blockers = deployBlockers(readWrangler(join(input.root, "apps", "server")))
  if (!input.dryRun && blockers.length > 0) {
    console.error("✖ deploy refused:")
    for (const b of blockers) console.error(`  ✖ ${b}`)
    return false
  }
  if (!(await dryRun(input.root))) {
    console.error("✖ deploy dry run failed")
    return false
  }
  if (input.dryRun) {
    for (const b of blockers) console.error(`  ! not deployable yet: ${b}`)
    console.error("✓ deploy dry run: the worker bundles and every migration applies")
    return true
  }
  const server = join(input.root, "apps", "server")
  console.error("── migrations (remote) ──")
  const remote = await run({
    cmd: ["bunx", "wrangler", "d1", "migrations", "apply", "DB", "--remote"],
    cwd: server,
    env: ENV,
  })
  if (remote !== 0) return false
  console.error("── wrangler deploy ──")
  return (await run({ cmd: ["bunx", "wrangler", "deploy"], cwd: server })) === 0
}
