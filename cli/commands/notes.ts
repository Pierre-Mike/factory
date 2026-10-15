/**
 * `axioms notes [--seal]`: the Agent Notes gate. Lists the files git sees, reads the Markdown and
 * hashes archived notes, then lets notes.core judge them. `--seal` appends newly archived notes to
 * each tree's `archived/manifest.json` and refuses when a sealed note changed.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import {
  ARCHIVE,
  afterSeal,
  blocksSeal,
  findTrees,
  MANIFEST,
  type Manifest,
  parseManifest,
  runNotes,
} from "../notes.core"
import { readJson, readText } from "../shell"

const gitFiles = (root: string): string[] =>
  Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
    .stdout.toString()
    .split("\n")
    .filter((path) => path !== "" && existsSync(join(root, path)))

const sha256 = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`

const readManifest = (path: string): Manifest | null | undefined =>
  existsSync(path) ? parseManifest(readJson(path)) : null

export const notes = async (input: {
  readonly root: string
  readonly seal: boolean
}): Promise<boolean> => {
  const files = gitFiles(input.root)
  const texts = new Map(
    files.filter((f) => f.endsWith(".md")).map((f) => [f, readText(join(input.root, f)) ?? ""]),
  )
  const hashes = new Map(
    [...texts].filter(([f]) => f.includes(`/${ARCHIVE}/`)).map(([f, text]) => [f, sha256(text)]),
  )
  const manifests = new Map(
    findTrees(files).map((tree) => [tree, readManifest(join(input.root, tree, ARCHIVE, MANIFEST))]),
  )
  const result = runNotes({ files, texts, hashes, manifests })
  let errors = result.errors

  if (input.seal) {
    const blocking = errors.filter(blocksSeal)
    if (blocking.length > 0) {
      console.error("✖ notes: refusing to seal; archived notes are frozen:")
      for (const e of blocking) console.error(`  ${e}`)
      return false
    }
    for (const [tree, manifest] of result.sealed) {
      await Bun.write(
        join(input.root, tree, ARCHIVE, MANIFEST),
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
      console.error(
        `✓ notes: sealed ${Object.keys(manifest.files).length} archived note(s) in ${tree}`,
      )
    }
    errors = afterSeal(errors)
  }

  if (errors.length === 0) {
    console.error(
      `✓ notes: ${result.noteCount} Agent Note(s) in ${result.treeCount} tree(s) follow the rules`,
    )
    return true
  }
  console.error("✖ notes: Agent Notes break the rules in .agents/notes/README.md:")
  for (const e of errors) console.error(`  ${e}`)
  return false
}
