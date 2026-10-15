/**
 * Downloads a pinned scanner on a CI runner and refuses it unless the archive matches the pinned
 * SHA256. The binary lands in node_modules/.cache/axioms-tools, where a later run reuses it.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { run } from "../shell"
import { checkDigest, pinnedAsset, type ToolName } from "../tools.core"

export const installPinned = async (input: {
  readonly root: string
  readonly tool: ToolName
}): Promise<string | undefined> => {
  const dir = join(input.root, "node_modules", ".cache", "axioms-tools")
  const asset = pinnedAsset({ tool: input.tool, platform: process.platform, arch: process.arch })
  if (asset === undefined) return undefined
  const cached = join(dir, asset.binary)
  if (existsSync(cached)) return cached
  const response = await fetch(asset.url)
  if (!response.ok) {
    console.error(`✖ ${input.tool}: download failed (${response.status}) ${asset.url}`)
    return undefined
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const problem = checkDigest({
    asset,
    digest: createHash("sha256").update(bytes).digest("hex"),
  })
  if (problem !== undefined) {
    console.error(`✖ ${input.tool}: ${problem}`)
    return undefined
  }
  await mkdir(dir, { recursive: true })
  const archive = join(dir, `${input.tool}-${asset.version}.tar.gz`)
  await Bun.write(archive, bytes)
  const code = await run({
    cmd: ["tar", "-xzf", archive, "-C", dir, asset.binary],
    cwd: input.root,
  })
  return code === 0 ? cached : undefined
}
