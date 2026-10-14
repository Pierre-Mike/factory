/**
 * `axioms sync`: make the project's copies of the harness match the installed version. Rewrites
 * the canon block in AGENTS.md, points CLAUDE.md at it, and makes biome.json and lefthook.yml
 * extend the harness. Run after `bun update @pierre-mike/axioms`.
 */
import { join } from "node:path"
import { writeCanon } from "../canon.core"
import { HARNESS_BIOME, HARNESS_LEFTHOOK, isRecord } from "../doctor.core"
import { HARNESS_DIR, readJson, readText, run, toolPath } from "../shell"

const DEFAULT_INCLUDES = [
  "**",
  "!**/dist",
  "!**/node_modules",
  "!**/.wrangler",
  "!**/routeTree.gen.ts",
]

export const sync = async (root: string): Promise<void> => {
  const canon = readText(join(HARNESS_DIR, "canon.md")) ?? ""

  const agentsPath = join(root, "AGENTS.md")
  await Bun.write(agentsPath, writeCanon({ agentsMd: readText(agentsPath) ?? "", canon }))

  const claudePath = join(root, "CLAUDE.md")
  const claude = readText(claudePath) ?? ""
  if (!claude.includes("@AGENTS.md")) {
    await Bun.write(claudePath, `@AGENTS.md\n${claude === "" ? "" : `\n${claude}`}`)
  }

  const biomePath = join(root, "biome.json")
  const biome = readJson(biomePath)
  const files =
    isRecord(biome) && isRecord(biome.files) ? biome.files : { includes: DEFAULT_INCLUDES }
  await Bun.write(
    biomePath,
    `${JSON.stringify(
      {
        $schema: "./node_modules/@biomejs/biome/configuration_schema.json",
        extends: [HARNESS_BIOME],
        vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
        files,
      },
      null,
      2,
    )}\n`,
  )

  await Bun.write(
    join(root, "lefthook.yml"),
    `# Hooks come from the harness. Run \`bunx axioms sync\` after upgrading it.\nextends:\n  - ${HARNESS_LEFTHOOK}\n`,
  )

  if (readText(join(root, ".git", "HEAD")) !== null) {
    await run({ cmd: ["bun", toolPath("lefthook"), "install"], cwd: root })
  }
  console.error("✓ synced AGENTS.md, CLAUDE.md, biome.json and lefthook.yml with the harness")
}
