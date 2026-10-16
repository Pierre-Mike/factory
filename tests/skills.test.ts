/**
 * The skills under harness/skills/ are copied into every project, so a broken one breaks
 * everywhere at once. These tests pin what Claude Code needs to load a skill (frontmatter whose
 * name matches its folder, a description, model invocation left on), that every link inside a
 * skill resolves, that every command a skill tells an agent to run exists, that each skill
 * carries its license credits, and that the pull-request skill's example body passes the
 * pr-body gate against both shipped templates.
 */
import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join, normalize } from "node:path"
import { sectionProblems, templateHeadings } from "../cli/pr-body.core"
import { HARNESS_DIR, PKG_ROOT, readText, TEMPLATE_DIR } from "../cli/shell"

const SKILLS_DIR = join(HARNESS_DIR, "skills")

const skillNames = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const skillFiles = (name: string): string[] =>
  [...new Bun.Glob("**/*").scanSync({ cwd: join(SKILLS_DIR, name) })].sort()

const read = (path: string): string => readText(path) ?? ""

/** The `key: value` lines between the leading `---` fences, or `null` when there are none. */
const frontmatter = (text: string): Record<string, string> | null => {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1]
  if (block === undefined) return null
  return Object.fromEntries(
    block.split("\n").flatMap((line) => {
      const match = line.match(/^([\w-]+):\s*(.*)$/)
      return match?.[1] === undefined ? [] : [[match[1], match[2] ?? ""]]
    }),
  )
}

const cliCommands = new Set(
  [...read(join(PKG_ROOT, "cli", "main.ts")).matchAll(/case "([\w-]+)":/g)].map((m) => m[1]),
)
const templateScripts = new Set(
  Object.keys(
    (JSON.parse(read(join(TEMPLATE_DIR, "package.json"))) as { scripts: Record<string, string> })
      .scripts,
  ),
)

describe("harness/skills", () => {
  it("ships the factory skills", () => {
    expect(skillNames).toEqual(["peer-review", "pull-request", "tdd"])
  })

  for (const name of skillNames) {
    describe(name, () => {
      const skill = read(join(SKILLS_DIR, name, "SKILL.md"))
      const meta = frontmatter(skill)

      it("has SKILL.md frontmatter whose name matches the folder", () => {
        expect(meta?.name).toBe(name)
      })

      it("has a description Claude Code can match on, and leaves model invocation on", () => {
        expect(meta?.description?.length ?? 0).toBeGreaterThan(40)
        expect(meta?.description?.length ?? 0).toBeLessThanOrEqual(1024)
        expect(meta?.["disable-model-invocation"]).toBeUndefined()
      })

      it("carries a CREDITS.md that SKILL.md links to", () => {
        expect(existsSync(join(SKILLS_DIR, name, "CREDITS.md"))).toBe(true)
        expect(skill).toContain("](CREDITS.md)")
      })

      it("only links to files inside its own folder that exist", () => {
        for (const file of skillFiles(name).filter((path) => path.endsWith(".md"))) {
          const text = read(join(SKILLS_DIR, name, file))
          for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
            if (target === undefined || /^(https?:|#)/.test(target)) continue
            const resolved = normalize(join(dirname(file), target.split("#")[0] ?? ""))
            expect({ file, target, inside: !resolved.startsWith("..") }).toEqual({
              file,
              target,
              inside: true,
            })
            expect({ file, target, exists: existsSync(join(SKILLS_DIR, name, resolved)) }).toEqual({
              file,
              target,
              exists: true,
            })
          }
        }
      })

      it("only tells agents to run commands the project has", () => {
        for (const file of skillFiles(name)) {
          const text = read(join(SKILLS_DIR, name, file))
          for (const [, command] of text.matchAll(/bunx axioms ([\w-]+)/g)) {
            expect({ file, command, known: cliCommands.has(command) }).toEqual({
              file,
              command,
              known: true,
            })
          }
          for (const [, script] of text.matchAll(/bun run ([\w-]+(?::[\w-]+)*)/g)) {
            expect({ file, script, known: templateScripts.has(script ?? "") }).toEqual({
              file,
              script,
              known: true,
            })
          }
        }
      })
    })
  }
})

describe("pull-request example body", () => {
  const body = read(join(SKILLS_DIR, "pull-request", "example-body.md"))

  for (const path of [
    ".github/PULL_REQUEST_TEMPLATE.md",
    "template/.github/PULL_REQUEST_TEMPLATE.md",
  ]) {
    it(`fills every section of ${path}`, () => {
      const template = read(join(PKG_ROOT, path))
      expect(templateHeadings(template).length).toBeGreaterThan(0)
      expect(sectionProblems({ body, required: templateHeadings(template) })).toEqual([])
    })
  }
})
