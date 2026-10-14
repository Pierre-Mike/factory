/**
 * `axioms new <dir> [--harness <spec>]`: stamp a project from template/, pin the harness, and sync
 * the rules into it. The default harness spec is the GitHub tag of the running version; when the
 * CLI runs from a checkout (not from node_modules) it pins `file:` to that checkout instead.
 */
import { existsSync } from "node:fs"
import { cp, readdir } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import { HARNESS_PACKAGE } from "../doctor.core"
import { fail, harnessVersion, PKG_ROOT, run, runTool, TEMPLATE_DIR } from "../shell"
import { sync } from "./sync"

const TEXT = /\.(ts|tsx|json|jsonc|md|yml|yaml|html|sql|toml)$|^\.gitignore$/
const SKIP = new Set(["node_modules", "dist", ".wrangler", "bun.lock"])

const defaultSpec = (target: string): string =>
  PKG_ROOT.includes("node_modules")
    ? `github:Pierre-Mike/factory#v${harnessVersion()}`
    : `file:${relative(target, PKG_ROOT)}`

const replaceIn = async (input: {
  readonly dir: string
  readonly appName: string
}): Promise<void> => {
  for (const entry of await readdir(input.dir, { withFileTypes: true })) {
    const path = join(input.dir, entry.name)
    if (entry.isDirectory()) await replaceIn({ dir: path, appName: input.appName })
    else if (TEXT.test(entry.name)) {
      const text = await Bun.file(path).text()
      if (text.includes("__APP_NAME__"))
        await Bun.write(path, text.replaceAll("__APP_NAME__", input.appName))
    }
  }
}

export const newProject = async (args: ReadonlyArray<string>): Promise<void> => {
  const dir = args.find((a) => !a.startsWith("-"))
  if (dir === undefined) fail("usage: axioms new <dir> [--harness <spec>] [--no-install]")
  const target = resolve(dir ?? "")
  if (existsSync(target)) fail(`${target} already exists`)
  const appName = basename(target)
  if (!/^[a-z][a-z0-9-]*$/.test(appName)) fail(`app name "${appName}" must be lowercase kebab-case`)

  const flag = args.indexOf("--harness")
  const spec =
    flag === -1 ? defaultSpec(target) : (args[flag + 1] ?? fail("--harness needs a value"))

  await cp(TEMPLATE_DIR, target, {
    recursive: true,
    filter: (src) => !SKIP.has(basename(src)),
  })
  await replaceIn({ dir: target, appName })

  const pkgPath = join(target, "package.json")
  const pkg = JSON.parse(await Bun.file(pkgPath).text())
  pkg.devDependencies = { ...pkg.devDependencies, [HARNESS_PACKAGE]: spec }
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  await run({ cmd: ["git", "init", "-q", "-b", "main"], cwd: target })
  await sync(target)
  if (!args.includes("--no-install")) {
    if ((await run({ cmd: ["bun", "install"], cwd: target })) !== 0) fail("bun install failed")
    await runTool({ tool: "lefthook", args: ["install"], cwd: target })
    await runTool({ tool: "biome", args: ["check", "--write", "."], cwd: target })
    await run({ cmd: ["git", "add", "-A"], cwd: target })
    await run({
      cmd: [
        "git",
        "commit",
        "-q",
        "-m",
        `chore: scaffold from ${HARNESS_PACKAGE} v${harnessVersion()}`,
      ],
      cwd: target,
    })
  }
  console.error(`
✓ created ${target} (harness: ${spec})

next:
  cd ${relative(process.cwd(), target) || "."}
  bun run check && bun run smoke
  bun run dev`)
}
