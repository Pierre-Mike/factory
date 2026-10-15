/**
 * `axioms new <dir> [--harness <spec>] [--no-install]`: stamp a project from template/, pin the
 * harness, and sync the rules into it. The default harness spec is the GitHub tag of the running
 * version, also when the CLI runs from a checkout: `axioms doctor` rejects a local path, so a
 * `file:` default would hand out a project that fails its first `check`.
 */
import { existsSync } from "node:fs"
import { cp, readdir } from "node:fs/promises"
import { basename, join, relative, resolve } from "node:path"
import { HARNESS_PACKAGE } from "../doctor.core"
import { parseNewArgs, releaseSpec } from "../new.core"
import { fail, harnessVersion, run, runTool, TEMPLATE_DIR } from "../shell"
import { sync } from "./sync"

const TEXT = /\.(ts|tsx|json|jsonc|md|yml|yaml|html|sql|toml|lock)$|^\.gitignore$/
// template/bun.lock is copied: a new project (and the selftest) installs the versions the factory
// tested, not whatever was published this morning. `bun run lock:template` refreshes it.
const SKIP = new Set(["node_modules", "dist", ".wrangler"])

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

export const newProject = async (argv: ReadonlyArray<string>): Promise<void> => {
  const parsed = parseNewArgs(argv)
  if (!parsed.ok) return fail(parsed.error)
  const { dir, harness, install } = parsed.args
  const target = resolve(dir)
  if (existsSync(target)) fail(`${target} already exists`)
  const appName = basename(target)
  if (!/^[a-z][a-z0-9-]*$/.test(appName)) fail(`app name "${appName}" must be lowercase kebab-case`)

  const spec = harness ?? releaseSpec(harnessVersion())

  await cp(TEMPLATE_DIR, target, {
    recursive: true,
    filter: (src) => !SKIP.has(basename(src)),
  })
  await replaceIn({ dir: target, appName })

  const pkgPath = join(target, "package.json")
  const pkg = JSON.parse(await Bun.file(pkgPath).text())
  pkg.devDependencies = { ...pkg.devDependencies, [HARNESS_PACKAGE]: spec }
  await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  // A step that fails must stop here: printing "created" over a project with no hooks or no first
  // commit hands out something that breaks on the first push (ci-dry-run needs HEAD).
  const step = async (input: { readonly name: string; readonly code: Promise<number> }) => {
    if ((await input.code) !== 0) fail(`${input.name} failed in ${target}`)
  }
  await step({
    name: "git init",
    code: run({ cmd: ["git", "init", "-q", "-b", "main"], cwd: target }),
  })
  await sync(target)
  if (install) {
    await step({
      name: "bun install (can git reach the private harness? see the factory README)",
      code: run({ cmd: ["bun", "install"], cwd: target }),
    })
    await step({
      name: "lefthook install",
      code: runTool({ tool: "lefthook", args: ["install"], cwd: target }),
    })
    await step({
      name: "biome check --write",
      code: runTool({ tool: "biome", args: ["check", "--write", "."], cwd: target }),
    })
    await step({ name: "git add", code: run({ cmd: ["git", "add", "-A"], cwd: target }) })
    await step({
      name: "the first commit (is git user.name and user.email set?)",
      code: run({
        cmd: [
          "git",
          "commit",
          "-q",
          "-m",
          `chore: scaffold from ${HARNESS_PACKAGE} v${harnessVersion()}`,
        ],
        cwd: target,
      }),
    })
  }
  console.error(`
✓ created ${target} (harness: ${spec})

next:
  cd ${relative(process.cwd(), target) || "."}
  bun run check && bun run smoke
  bun run dev

before the first push, give CI read access to the private harness:
  gh secret set HARNESS_TOKEN   # a fine-grained token: Pierre-Mike/factory, Contents read-only`)
}
