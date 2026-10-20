/** `axioms slice <name> [--door] [--no-io]`: write a new feature slice and wire it in. */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fail, readText, runTool } from "../shell"
import { nextSteps, parseSliceArgs, sliceFiles, type WiringSources, wireSlice } from "../slice.core"

export const slice = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}) => {
  const args = parseSliceArgs(input.args)
  if (!args.ok) return fail(args.error)
  const { name, door, io } = args

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
    io,
    sources: {
      api: readText(paths.api) ?? "",
      runtime: readText(paths.runtime) ?? "",
      http: readText(paths.http) ?? "",
    },
  })
  if (!wired.ok) return fail(wired.error)

  const files = sliceFiles({ name, door, io })
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

  console.error(`\n${nextSteps({ name, io })}`)
}
