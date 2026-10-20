/** `axioms doctor`: read the project's harness files and report what is missing or unwired. */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import {
  CLAUDE_SETTINGS,
  CLAUDE_SKILLS_DIR,
  type DoctorInput,
  type Finding,
  HTTP_BOUNDARY,
  isRecord,
  parseAllowlistedTags,
  runDoctor,
  TSCONFIG_BASE,
} from "../doctor.core"
import { NOTES_DIR } from "../notes.core"
import { checkGithubRules, githubNotice } from "../rules.core"
import { HARNESS_DIR, harnessSkillFiles, harnessVersion, readJson, readText } from "../shell"
import { readGithubInput } from "./github"

const listDir = (path: string): string[] => (existsSync(path) ? readdirSync(path) : [])

/** Subfolders only: a stray file such as macOS's .DS_Store is not a feature. */
const listSubdirs = (path: string): string[] =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []

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

const serverSources = async (serverSrc: string): Promise<DoctorInput["serverSources"]> => {
  // An adopted (lite) repo has no apps/server at all; scanning a missing folder throws.
  if (!existsSync(serverSrc)) return []
  const glob = new Bun.Glob("**/*.ts")
  const files: { path: string; text: string }[] = []
  for await (const path of glob.scan({ cwd: serverSrc })) {
    files.push({ path, text: await Bun.file(join(serverSrc, path)).text() })
  }
  return files
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

/** tsconfig files are JSONC (comments allowed), so JSON.parse is not enough. */
const readTsconfig = (input: { readonly root: string; readonly path: string }) => {
  const text = readText(join(input.root, input.path))
  if (text === null) return { path: input.path, config: null }
  const parsed = ts.parseConfigFileTextToJson(input.path, text)
  return { path: input.path, config: parsed.error === undefined ? (parsed.config ?? null) : null }
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
    notesRules: readText(join(HARNESS_DIR, "notes.md")) ?? "",
    notesReadme: readText(join(root, NOTES_DIR, "README.md")),
    harnessSettings: readText(join(HARNESS_DIR, "claude.settings.json")) ?? "",
    claudeSettings: readText(join(root, CLAUDE_SETTINGS)),
    skillCopies: (await harnessSkillFiles()).map((file) => ({
      path: file.path,
      harness: file.text,
      project: readText(join(root, CLAUDE_SKILLS_DIR, file.path)),
    })),
    pkg,
    workspaceDirs: workspaceDirs({ root, pkg }),
    tsconfigReferences: refs.flatMap((ref) =>
      isRecord(ref) && typeof ref.path === "string" ? [ref.path] : [],
    ),
    tsconfigs: [
      TSCONFIG_BASE,
      ...workspaceDirs({ root, pkg }).map((dir) => `${dir}/tsconfig.json`),
    ].map((path) => readTsconfig({ root, path })),
    nestedBiomeConfigs: nestedBiomeConfigs(root),
    ciWorkflow: readYaml(join(root, ".github", "workflows", "ci.yml")),
    featureNames: listSubdirs(join(server, "src", "features")),
    smokeFiles: listDir(join(server, "smoke")),
    allowlistedTags: parseAllowlistedTags(readText(join(server, "src", HTTP_BOUNDARY)) ?? ""),
    serverSources: await serverSources(join(server, "src")),
    allowLocalHarness: process.env.AXIOMS_ALLOW_LOCAL_HARNESS === "1",
    harnessVersion: harnessVersion(),
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

export const doctor = async (root: string): Promise<boolean> => {
  const github = readGithubInput(root)
  const notice = githubNotice(github.state)
  if (notice !== undefined) console.error(notice)
  return report([...runDoctor(await readDoctorInput(root)), ...checkGithubRules(github)])
}
