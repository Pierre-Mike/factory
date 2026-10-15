/**
 * Shared shell helpers for the CLI: where the harness lives, how to find the tools it pins, and
 * how to run them. The tools are dependencies of this package, so every project runs the same
 * Biome, TypeScript and fallow versions as the harness was tested with.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

export const PKG_ROOT = join(import.meta.dir, "..")
export const HARNESS_DIR = join(PKG_ROOT, "harness")
export const TEMPLATE_DIR = join(PKG_ROOT, "template")

export const harnessVersion = (): string => {
  const pkg: unknown = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"))
  return typeof pkg === "object" &&
    pkg !== null &&
    "version" in pkg &&
    typeof pkg.version === "string"
    ? pkg.version
    : "0.0.0"
}

const BINS = {
  biome: { pkg: "@biomejs/biome", bin: "bin/biome" },
  tsc: { pkg: "typescript", bin: "bin/tsc" },
  fallow: { pkg: "fallow", bin: "bin/fallow" },
  lefthook: { pkg: "lefthook", bin: "bin/index.js" },
} as const

export type Tool = keyof typeof BINS

/** Absolute path of a pinned tool's entry script, resolved from this package. */
export const toolPath = (tool: Tool): string => {
  const { pkg, bin } = BINS[tool]
  const manifest = Bun.resolveSync(`${pkg}/package.json`, PKG_ROOT)
  return join(dirname(manifest), bin)
}

export const fail = (message: string): never => {
  console.error(`✖ ${message}`)
  process.exit(1)
}

/** Receives everything a gate writes, so `check --json` can report per-gate evidence. */
export type Sink = (text: string) => void

export interface RunOptions {
  readonly cmd: ReadonlyArray<string>
  readonly cwd: string
  readonly env?: Record<string, string>
  /** false: the command sees `env` only, not this process's environment. Defaults to true. */
  readonly inheritEnv?: boolean
  /**
   * When set, the child's stdout and stderr are piped into the sink and teed to this process's
   * stderr, keeping stdout free for a machine-readable report. Default: inherited stdio.
   */
  readonly sink?: Sink
}

/** Forward a child's stream to this process's stderr and to the sink. */
export const teeStream = async (input: {
  readonly stream: ReadableStream<Uint8Array>
  readonly sink: Sink
}): Promise<void> => {
  const decoder = new TextDecoder()
  const forward = (text: string) => {
    if (text === "") return
    process.stderr.write(text)
    input.sink(text)
  }
  for await (const chunk of input.stream) forward(decoder.decode(chunk, { stream: true }))
  forward(decoder.decode())
}

/** Run a command and return its exit code; see `RunOptions.sink` for where its output goes. */
export const run = async (opts: RunOptions): Promise<number> => {
  const env = opts.inheritEnv === false ? { ...opts.env } : { ...process.env, ...opts.env }
  if (opts.sink === undefined) {
    const proc = Bun.spawn([...opts.cmd], {
      cwd: opts.cwd,
      env,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    })
    return await proc.exited
  }
  const proc = Bun.spawn([...opts.cmd], {
    cwd: opts.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  })
  await Promise.all([
    teeStream({ stream: proc.stdout, sink: opts.sink }),
    teeStream({ stream: proc.stderr, sink: opts.sink }),
  ])
  return await proc.exited
}

/** Run one of the pinned tools through bun. */
export const runTool = (input: {
  readonly tool: Tool
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  readonly sink?: Sink
}) => run({ cmd: ["bun", toolPath(input.tool), ...input.args], cwd: input.cwd, sink: input.sink })

export const readText = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, "utf8") : null

/** Every file under harness/skills/ with its content, sorted by path: what `axioms sync` installs into a project's .claude/skills/. */
export const harnessSkillFiles = async (): Promise<
  ReadonlyArray<{ readonly path: string; readonly text: string }>
> => {
  const dir = join(HARNESS_DIR, "skills")
  const paths: string[] = []
  for await (const path of new Bun.Glob("**/*").scan({ cwd: dir })) paths.push(path)
  return Promise.all(
    paths.sort().map(async (path) => ({ path, text: await Bun.file(join(dir, path)).text() })),
  )
}

export const readJson = (path: string): unknown => {
  const text = readText(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Walk up from `start` to the first package.json that declares workspaces: the project root. */
export const projectRoot = (start: string): string => {
  let dir = start
  while (true) {
    const pkg = readJson(join(dir, "package.json"))
    if (typeof pkg === "object" && pkg !== null && "workspaces" in pkg) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}
