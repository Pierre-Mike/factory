/** `axioms slice <name> [--door]`: write a new feature slice and wire it in. */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fail, readText, runTool } from "../shell"
import { isSliceName, sliceFiles, type WiringSources, wireSlice } from "../slice.core"

const USAGE = "usage: axioms slice <feature> [--door]   (kebab-case, e.g. user-profile)"

export const slice = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}) => {
  const unknownFlag = input.args.find((a) => a.startsWith("-") && a !== "--door")
  if (unknownFlag !== undefined) fail(`unknown flag ${unknownFlag}\n${USAGE}`)
  const name = input.args.find((a) => !a.startsWith("-")) ?? ""
  if (!isSliceName(name)) fail(USAGE)

  const server = join(input.root, "apps", "server")
  if (existsSync(join(server, "src", "features", name))) fail(`slice already exists: ${name}`)

  // Every edit is computed before anything is written: a missing anchor fails with no files touched.
  const paths: WiringSources = {
    api: join(server, "src", "api.ts"),
    runtime: join(server, "src", "platform", "runtime.ts"),
    http: join(server, "src", "platform", "http.ts"),
  }
  const wired = wireSlice({
    name,
    sources: {
      api: readText(paths.api) ?? "",
      runtime: readText(paths.runtime) ?? "",
      http: readText(paths.http) ?? "",
    },
  })
  if (!wired.ok) return fail(wired.error)

  const files = sliceFiles({ name, door: input.args.includes("--door") })
  for (const [rel, content] of Object.entries(files)) {
    const path = join(server, rel)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, content)
    console.error(`created apps/server/${rel}`)
  }
  await Bun.write(paths.api, wired.sources.api)
  await Bun.write(paths.runtime, wired.sources.runtime)
  await Bun.write(paths.http, wired.sources.http)
  await runTool({
    tool: "biome",
    args: [
      "check",
      "--write",
      "--no-errors-on-unmatched",
      join(server, "src"),
      join(server, "smoke"),
    ],
    cwd: input.root,
  })

  console.error(`
next steps:
  1. add a migration in apps/server/migrations/ if ${name} stores data
  2. write the pure logic in ${name}.core.ts and its test
  3. replace the stub in ${name}.io.ts (deps.db is the SQL port)
  4. register new error tags in platform/http.ts
  5. make smoke/${name}.smoke.test.ts check the real behaviour
  6. bun run check && bun run smoke`)
}
