/**
 * Agent Notes gate, pure. A decision an agent makes in one session is recorded as a note under
 * `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`, so the next session finds it instead of
 * guessing. The rules are in harness/notes.md, which `axioms sync` copies to
 * `.agents/notes/README.md`. The shell (commands/notes.ts) lists files, reads Markdown and hashes
 * archived notes; this module only judges them. Four gates:
 *
 *   structure  closed lifecycle and class folders, depth, filenames, no INDEX.md
 *   format     header block, Status matches the folder, required sections per lifecycle
 *   links      relative links out of active notes, and from any Markdown file into a notes tree
 *   archive    archived notes carry `Archived: YYYY-MM-DD` and match `archived/manifest.json`
 *
 * Adapted from the `agent-notes` skill's check-notes.ts. The class set is fixed here: like the
 * Biome rules, a project changes it in the factory, not locally.
 */

export const NOTES_DIR = ".agents/notes"
export const LIFECYCLES = ["proposed", "implemented", "rejected"] as const
export const ARCHIVE = "archived"
export const MANIFEST = "manifest.json"
export const CLASSES = [
  "feature",
  "bug-fix",
  "simplification",
  "architecture",
  "process",
  "testing",
] as const

/** Non-note files allowed at the tree root or directly under a lifecycle folder. */
const ROOT_ALLOWLIST = new Set(["AGENTS.md", "CLAUDE.md", "README.md"])

const STATUS: Record<string, RegExp> = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected (?:—|-|:) \S.*$/,
}

/** Required `##` sections per lifecycle, after the `## Problem` every note opens with. */
const REQUIRED: Record<string, ReadonlyArray<string>> = {
  proposed: ["## Proposal", "## Acceptance criteria", "## Risks"],
  implemented: ["## Decision", "## Consequences"],
  rejected: ["## Proposal"],
}

/** Proposal-era headings: an implemented note states what is, not what will be. */
const BANNED_IMPLEMENTED = /^## (?:Proposal|Plan|Migration plan|Acceptance criteria|Risks)\b/i

export interface Note {
  /** Repo-relative path of the notes tree, e.g. ".agents/notes". */
  readonly tree: string
  /** "proposed" | "implemented" | "rejected" | "archived" */
  readonly lifecycle: string
  /** Path inside the tree, e.g. "implemented/feature/2026-09-29-pdf-export.md". */
  readonly rel: string
  /** yyyy-mm-dd from the filename. */
  readonly date: string
}

export interface Manifest {
  readonly version: 1
  /** Path inside archived/ to content hash. */
  readonly files: Readonly<Record<string, string>>
}

export const notePath = (note: Note): string => `${note.tree}/${note.rel}`

/** Lines outside fenced code blocks: format tokens inside examples are not structure. */
export const proseLines = (text: string): string[] => {
  let inFence = false
  return text.split("\n").filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return false
    }
    return !inFence
  })
}

/** Repo-relative notes-tree roots among repo-relative file paths. */
export const findTrees = (files: ReadonlyArray<string>): string[] => {
  const trees = new Set<string>()
  for (const file of files) {
    const at = file.indexOf(`${NOTES_DIR}/`)
    if (at === 0 || (at > 0 && file[at - 1] === "/"))
      trees.add(file.slice(0, at + NOTES_DIR.length))
  }
  return [...trees].sort()
}

/** Gate 1: classify every file under one tree; anything off-layout is an error. */
export const checkStructure = (input: {
  readonly tree: string
  readonly rels: ReadonlyArray<string>
}): { notes: Note[]; errors: string[] } => {
  const notes: Note[] = []
  const errors: string[] = []
  const known = new Set<string>([...LIFECYCLES, ARCHIVE])
  const classes: ReadonlyArray<string> = CLASSES
  for (const rel of [...input.rels].sort()) {
    const segs = rel.split("/")
    const where = `${input.tree}/${rel}`
    const [lifecycle = "", cls = "", base = ""] = segs
    if (segs.length === 1) {
      if (lifecycle === "INDEX.md")
        errors.push(`structure: ${where}: no central index; the folder tree is the index`)
      else if (!ROOT_ALLOWLIST.has(lifecycle))
        errors.push(
          `structure: ${where}: only ${[...ROOT_ALLOWLIST].join(", ")} may sit at the tree root`,
        )
      continue
    }
    if (!known.has(lifecycle)) {
      errors.push(
        `structure: ${where}: unknown lifecycle folder "${lifecycle}" (allowed: ${[...known].join(", ")})`,
      )
      continue
    }
    if (segs.length === 2) {
      const manifestOk = lifecycle === ARCHIVE && cls === MANIFEST
      if (!manifestOk && !ROOT_ALLOWLIST.has(cls))
        errors.push(`structure: ${where}: expected ${lifecycle}/{class}/yyyy-mm-dd-topic.md`)
      continue
    }
    if (segs.length !== 3) {
      errors.push(
        `structure: ${where}: expected ${lifecycle}/{class}/yyyy-mm-dd-topic.md (got depth ${segs.length})`,
      )
      continue
    }
    if (!classes.includes(cls)) {
      errors.push(
        `structure: ${where}: unknown class folder "${cls}" (allowed: ${classes.join(", ")})`,
      )
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(base)) {
      errors.push(`structure: ${where}: the filename must be yyyy-mm-dd-kebab-topic.md`)
      continue
    }
    notes.push({ tree: input.tree, lifecycle, rel, date: base.slice(0, 10) })
  }
  return { notes, errors }
}

/** Gate 2: the header block and the lifecycle's sections of one active note. */
export const checkFormat = (input: { readonly note: Note; readonly text: string }): string[] => {
  const { note } = input
  const errors: string[] = []
  const fail = (msg: string) => errors.push(`format: ${notePath(note)}: ${msg}`)
  const lines = input.text.split("\n")
  const prose = proseLines(input.text)

  if (!/^# Agent Note: \S/.test(lines[0] ?? "")) fail("line 1 must be `# Agent Note: <title>`")
  if (lines[1] !== "") fail("line 2 must be blank")
  const status = STATUS[note.lifecycle]
  if (status !== undefined && !status.test(lines[2] ?? "")) {
    const want =
      note.lifecycle === "rejected"
        ? "Status: rejected — <one-line reason>"
        : `Status: ${note.lifecycle}`
    fail(
      `line 3 must be \`${want}\` to match its ${note.lifecycle}/ folder (got ${JSON.stringify(lines[2] ?? "")})`,
    )
  }
  if (lines[3] !== "") fail("line 4 must be blank")
  if (prose.filter((l) => l.startsWith("Status:")).length > 1)
    fail("the line-3 `Status:` line must be the only one in the file")

  const h2s = prose.filter((l) => l.startsWith("## ")).map((l) => l.trimEnd())
  if (h2s[0] !== "## Problem")
    fail(`the first section must be \`## Problem\` (got ${JSON.stringify(h2s[0] ?? "<none>")})`)
  for (const required of REQUIRED[note.lifecycle] ?? []) {
    if (!h2s.includes(required)) fail(`missing the required \`${required}\` section`)
  }
  if (note.lifecycle === "implemented") {
    for (const h2 of h2s.filter((h) => BANNED_IMPLEMENTED.test(h)))
      fail(
        `\`${h2}\` is a proposal-era heading; rewrite it into present-tense Decision, Consequences and Verification`,
      )
  }
  if (!h2s.includes("## Alternatives considered"))
    fail("missing `## Alternatives considered` (every note records what the decision beat)")
  return errors
}

/** Gate 4a: an archived note keeps its implemented header plus one archive-date line. */
export const checkArchivedHeader = (input: {
  readonly note: Note
  readonly text: string
}): string[] => {
  const errors: string[] = []
  const fail = (msg: string) => errors.push(`archive: ${notePath(input.note)}: ${msg}`)
  const lines = input.text.split("\n")
  if (!/^# Agent Note: \S/.test(lines[0] ?? "")) fail("line 1 must be `# Agent Note: <title>`")
  if (lines[2] !== "Status: implemented")
    fail("line 3 must stay `Status: implemented` (only implemented notes are archived)")
  const archived = (lines[3] ?? "").match(/^Archived: (\d{4}-\d{2}-\d{2})$/)
  if (archived?.[1] === undefined) fail("line 4 must be `Archived: YYYY-MM-DD`")
  else if (archived[1] < input.note.date)
    fail(`archive date ${archived[1]} precedes the note's date ${input.note.date}`)
  return errors
}

/** Relative link targets in Markdown prose, anchors and queries stripped. */
export const relativeLinks = (text: string): string[] => {
  const targets: string[] = []
  for (const line of proseLines(text)) {
    const unquoted = line.replace(/`[^`]*`/g, "")
    for (const m of unquoted.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const raw = m[1] ?? ""
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("#") || raw.startsWith("/")) continue
      const target = raw.split("#")[0]?.split("?")[0] ?? ""
      if (target.length > 0) targets.push(target)
    }
  }
  return targets
}

/** posix-normalize a repo-relative path; a result starting with ".." escapes the repo. */
export const normalize = (path: string): string => {
  const out: string[] = []
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop()
    else out.push(seg)
  }
  return out.join("/")
}

const dirname = (path: string): string => path.split("/").slice(0, -1).join("/")

/**
 * Gate 3: links that break when notes move between lifecycle folders. Checks every relative link
 * out of an active note, and links from any other Markdown file that point into a notes tree.
 */
export const checkLinks = (input: {
  readonly from: string
  readonly text: string
  /** Every repo-relative file and directory. */
  readonly existing: ReadonlySet<string>
  readonly fromActiveNote: boolean
}): string[] =>
  relativeLinks(input.text).flatMap((target) => {
    const resolved = normalize(`${dirname(input.from)}/${target}`)
    const intoNotes = resolved.startsWith(NOTES_DIR) || resolved.includes(`/${NOTES_DIR}`)
    if (!input.fromActiveNote && !intoNotes) return []
    return resolved.startsWith("..") || !input.existing.has(resolved)
      ? [`links: ${input.from}: broken link to ${target}`]
      : []
  })

/** The manifest as stored, or `undefined` when it is not a valid one. */
export const parseManifest = (value: unknown): Manifest | undefined => {
  if (typeof value !== "object" || value === null || !("files" in value)) return undefined
  const files = value.files
  if (typeof files !== "object" || files === null) return undefined
  const entries = Object.entries(files)
  return entries.every(([, hash]) => typeof hash === "string")
    ? { version: 1, files: Object.fromEntries(entries) }
    : undefined
}

const SEAL_HINT = "run `axioms notes --seal`"

/**
 * Gate 4b: archived notes are append-only. `current` maps each archived note's path inside
 * archived/ to its hash. No manifest is fine while the archive is empty; afterwards every note must
 * be sealed and unchanged, and no sealed note may disappear.
 */
export const checkSeal = (input: {
  readonly tree: string
  readonly current: ReadonlyMap<string, string>
  readonly manifest: Manifest | null
}): string[] => {
  const where = (rel: string) => `${input.tree}/${ARCHIVE}/${rel}`
  if (input.manifest === null)
    return input.current.size > 0
      ? [`archive: ${input.tree}/${ARCHIVE}/${MANIFEST} is missing; seal the archive: ${SEAL_HINT}`]
      : []
  const errors: string[] = []
  for (const [rel, hash] of Object.entries(input.manifest.files)) {
    const now = input.current.get(rel)
    if (now === undefined)
      errors.push(`archive: ${where(rel)}: a sealed note was moved or deleted; archives are frozen`)
    else if (now !== hash)
      errors.push(`archive: ${where(rel)}: a sealed note was edited; archives are frozen`)
  }
  for (const rel of input.current.keys()) {
    if (!(rel in input.manifest.files))
      errors.push(`archive: ${where(rel)}: not sealed; ${SEAL_HINT}`)
  }
  return errors
}

export interface NotesInput {
  /** Every repo-relative file, tracked or untracked but not ignored. */
  readonly files: ReadonlyArray<string>
  /** The text of every Markdown file in `files`. */
  readonly texts: ReadonlyMap<string, string>
  /** Repo-relative path of each archived note to its content hash. */
  readonly hashes: ReadonlyMap<string, string>
  /** Per tree, its parsed `archived/manifest.json`: `null` when absent, `undefined` when invalid. */
  readonly manifests: ReadonlyMap<string, Manifest | null | undefined>
}

export interface NotesResult {
  readonly errors: ReadonlyArray<string>
  readonly noteCount: number
  readonly treeCount: number
  /** Per tree with archived notes, the manifest `--seal` writes: existing entries plus new ones. */
  readonly sealed: ReadonlyMap<string, Manifest>
}

const withParents = (files: ReadonlyArray<string>): Set<string> => {
  const all = new Set<string>()
  for (const file of files) {
    let path = file
    while (path !== "" && !all.has(path)) {
      all.add(path)
      path = dirname(path)
    }
  }
  return all
}

export const runNotes = (input: NotesInput): NotesResult => {
  const errors: string[] = []
  const sealed = new Map<string, Manifest>()
  const archived = new Set<string>()
  const trees = findTrees(input.files)
  const text = (path: string) => input.texts.get(path) ?? ""
  let noteCount = 0

  for (const tree of trees) {
    const rels = input.files
      .filter((f) => f.startsWith(`${tree}/`))
      .map((f) => f.slice(tree.length + 1))
    const structure = checkStructure({ tree, rels })
    errors.push(...structure.errors)
    noteCount += structure.notes.length

    const current = new Map<string, string>()
    for (const note of structure.notes) {
      if (note.lifecycle === ARCHIVE) {
        archived.add(notePath(note))
        errors.push(...checkArchivedHeader({ note, text: text(notePath(note)) }))
        current.set(note.rel.slice(ARCHIVE.length + 1), input.hashes.get(notePath(note)) ?? "")
      } else {
        errors.push(...checkFormat({ note, text: text(notePath(note)) }))
      }
    }

    const manifest = input.manifests.has(tree) ? input.manifests.get(tree) : null
    if (manifest === undefined) {
      errors.push(`archive: ${tree}/${ARCHIVE}/${MANIFEST} is not a valid manifest`)
      continue
    }
    errors.push(...checkSeal({ tree, current, manifest }))
    if (current.size > 0) {
      const files: Record<string, string> = { ...manifest?.files }
      for (const [rel, hash] of [...current.entries()].sort()) files[rel] ??= hash
      sealed.set(tree, { version: 1, files })
    }
  }

  const existing = withParents(input.files)
  for (const file of input.files.filter((f) => f.endsWith(".md") && !archived.has(f))) {
    const fromActiveNote =
      trees.some((t) => file.startsWith(`${t}/`)) && !file.split("/").includes(ARCHIVE)
    errors.push(...checkLinks({ from: file, text: text(file), existing, fromActiveNote }))
  }
  return { errors, noteCount, treeCount: trees.length, sealed }
}

/** What `--seal` refuses over: an archive problem other than notes that are not sealed yet. */
export const blocksSeal = (error: string): boolean =>
  error.startsWith("archive:") && !error.endsWith(SEAL_HINT)

/** What is still wrong once `--seal` has written the manifests. */
export const afterSeal = (errors: ReadonlyArray<string>): string[] =>
  errors.filter((error) => !error.endsWith(SEAL_HINT))
