/**
 * `axioms slice <name> [--door] [--no-io]`: write a new feature slice and wire it in. On an
 * existing slice, `--door` adds only its door, for the moment its first consumer appears.
 */
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fail, readText, runTool } from "../shell"
import {
  doorFiles,
  doorNextSteps,
  nextSteps,
  parseSliceArgs,
  planSlice,
  sliceFiles,
  type WiringSources,
  wireSlice,
} from "../slice.core"

const writeFiles = async (input: {
  readonly server: string
  readonly files: Record<string, string>
}) => {
  for (const [rel, content] of Object.entries(input.files)) {
    const path = join(input.server, rel)
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, content)
    console.error(`created apps/server/${rel}`)
  }
}

export const slice = async (input: {
  readonly root: string
  readonly args: ReadonlyArray<string>
}) => {
  const args = parseSliceArgs(input.args)
  if (!args.ok) return fail(args.error)
  const { name, door, io } = args

  const server = join(input.root, "apps", "server")
  const dir = join(server, "src", "features", name)
  const plan = planSlice({
    args,
    existing: existsSync(dir)
      ? {
          io: existsSync(join(dir, `${name}.io.ts`)),
          door: existsSync(join(dir, `${name}.door.ts`)),
        }
      : null,
  })
  if (!plan.ok) return fail(plan.error)
  if (plan.plan === "door") {
    await writeFiles({ server, files: doorFiles({ name }) })
    console.error(`\nnext step:\n  ${doorNextSteps({ name })}`)
    return
  }

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

  await writeFiles({ server, files: sliceFiles({ name, door, io }) })
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

  console.error(`\n${nextSteps({ name, io, door })}`)
}
