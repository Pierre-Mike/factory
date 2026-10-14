/** `axioms doctor`: read the project's harness files and report what is missing or unwired. */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  type DoctorInput,
  type Finding,
  isRecord,
  parseAllowlistedTags,
  runDoctor,
} from "../doctor.core"
import { HARNESS_DIR, readJson, readText } from "../shell"

const listDir = (path: string): string[] => (existsSync(path) ? readdirSync(path) : [])

const workspaceDirs = (input: { readonly root: string; readonly pkg: unknown }): string[] => {
  const patterns =
    isRecord(input.pkg) && Array.isArray(input.pkg.workspaces) ? input.pkg.workspaces : []
  return patterns
    .filter((p): p is string => typeof p === "string")
    .flatMap((pattern) => {
      if (!pattern.endsWith("/*"))
        return existsSync(join(input.root, pattern, "package.json")) ? [pattern] : []
      const parent = pattern.slice(0, -2)
      return listDir(join(input.root, parent))
        .filter((entry) => existsSync(join(input.root, parent, entry, "package.json")))
        .map((entry) => `${parent}/${entry}`)
    })
    .sort()
}

const featureSource = async (serverSrc: string): Promise<string> => {
  const glob = new Bun.Glob("**/*.ts")
  const parts: string[] = []
  for await (const file of glob.scan({ cwd: serverSrc })) {
    if (file.endsWith(".test.ts") || file === "platform/http.ts") continue
    parts.push(await Bun.file(join(serverSrc, file)).text())
  }
  return parts.join("\n")
}

const effectRanges = (input: {
  readonly root: string
  readonly workspaces: ReadonlyArray<string>
}) =>
  input.workspaces.flatMap((workspace) => {
    const manifest = readJson(join(input.root, workspace, "package.json"))
    return ["dependencies", "devDependencies"].flatMap((kind) => {
      const deps = isRecord(manifest) ? manifest[kind] : undefined
      const range = isRecord(deps) ? deps.effect : undefined
      return typeof range === "string" ? [{ workspace, range }] : []
    })
  })

/** Biome configs below the root, tracked or not, skipping what .gitignore excludes. */
const nestedBiomeConfigs = (root: string): string[] => {
  const proc = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "**/biome.json",
      "**/biome.jsonc",
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  )
  return proc.stdout
    .toString()
    .split("\n")
    .filter((path) => path.includes("/"))
}

/** `null` when the file is missing, `undefined` when it is not valid YAML. */
const readYaml = (path: string): unknown => {
  const text = readText(path)
  if (text === null) return null
  try {
    return Bun.YAML.parse(text)
  } catch {
    return undefined
  }
}

export const readDoctorInput = async (root: string): Promise<DoctorInput> => {
  const pkg = readJson(join(root, "package.json"))
  const tsconfig = readJson(join(root, "tsconfig.json"))
  const refs = isRecord(tsconfig) && Array.isArray(tsconfig.references) ? tsconfig.references : []
  const server = join(root, "apps", "server")
  return {
    canon: readText(join(HARNESS_DIR, "canon.md")) ?? "",
    biome: readJson(join(root, "biome.json")),
    lefthook: readYaml(join(root, "lefthook.yml")),
    agentsMd: readText(join(root, "AGENTS.md")),
    claudeMd: readText(join(root, "CLAUDE.md")),
    pkg,
    workspaceDirs: workspaceDirs({ root, pkg }),
    tsconfigReferences: refs.flatMap((ref) =>
      isRecord(ref) && typeof ref.path === "string" ? [ref.path] : [],
    ),
    nestedBiomeConfigs: nestedBiomeConfigs(root),
    ciWorkflow: readYaml(join(root, ".github", "workflows", "ci.yml")),
    featureNames: listDir(join(server, "src", "features")),
    smokeFiles: listDir(join(server, "smoke")),
    allowlistedTags: parseAllowlistedTags(
      readText(join(server, "src", "platform", "http.ts")) ?? "",
    ),
    featureSource: await featureSource(join(server, "src")),
    allowLocalHarness: process.env.AXIOMS_ALLOW_LOCAL_HARNESS === "1",
    effectRanges: effectRanges({ root, workspaces: [".", ...workspaceDirs({ root, pkg })] }),
  }
}

export const report = (findings: ReadonlyArray<Finding>): boolean => {
  if (findings.length === 0) {
    console.error("✓ doctor: every harness gate is present and wired")
    return true
  }
  console.error("✖ doctor: the harness has drifted")
  for (const f of findings) console.error(`  ✖ [${f.rule}] ${f.problem}\n      → ${f.remedy}`)
  return false
}

export const doctor = async (root: string): Promise<boolean> =>
  report(runDoctor(await readDoctorInput(root)))
