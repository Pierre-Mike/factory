/**
 * The Claude Code settings file is security-relevant: it decides which commands an agent runs in
 * a project without a human approving them. These tests pin its shape, and keep the template's
 * stamped copy identical to the harness source, so `axioms sync` on a fresh project changes
 * nothing.
 */
import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { HARNESS_DIR, TEMPLATE_DIR } from "../cli/shell"

const readSettings = () => Bun.file(join(HARNESS_DIR, "claude.settings.json")).text()

const allowlist = async (): Promise<string[]> => {
  const settings: unknown = JSON.parse(await readSettings())
  if (typeof settings !== "object" || settings === null) throw new Error("settings is not JSON")
  const permissions = (settings as Record<string, unknown>).permissions
  const allow = (permissions as Record<string, unknown>).allow
  if (!Array.isArray(allow)) throw new Error("permissions.allow is not an array")
  return allow.filter((entry): entry is string => typeof entry === "string")
}

describe("harness/claude.settings.json", () => {
  it("is stamped into the template byte for byte", async () => {
    const stamped = await Bun.file(join(TEMPLATE_DIR, ".claude", "settings.json")).text()
    expect(stamped).toBe(await readSettings())
  })

  it("holds a permissions allowlist and nothing else (no hooks, no deny)", async () => {
    const settings = JSON.parse(await readSettings()) as Record<string, unknown>
    expect(Object.keys(settings).sort()).toEqual(["$schema", "permissions"])
    expect(Object.keys(settings.permissions as Record<string, unknown>)).toEqual(["allow"])
  })

  it("allows only the project's own gate commands, never a real deploy", async () => {
    const allow = await allowlist()
    expect(allow.length).toBeGreaterThan(0)
    for (const entry of allow) {
      expect(entry).toMatch(/^Bash\((bun run |bunx axioms )[^)]+\)$/)
      expect(entry).not.toMatch(/axioms deploy|bun run deploy\)|run deploy | install/)
    }
  })

  it("keeps prefix wildcards for the two hook commands with variable arguments only", async () => {
    const prefixed = (await allowlist()).filter((entry) => entry.endsWith(":*)"))
    expect(prefixed.sort()).toEqual([
      "Bash(bunx axioms biome check --write --no-errors-on-unmatched:*)",
      "Bash(bunx axioms commit-msg:*)",
    ])
  })
})
