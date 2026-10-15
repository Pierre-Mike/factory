import { describe, expect, it } from "bun:test"
import * as fc from "fast-check"
import {
  afterSeal,
  blocksSeal,
  checkFormat,
  checkStructure,
  findTrees,
  type Manifest,
  type NotesInput,
  normalize,
  parseManifest,
  relativeLinks,
  runNotes,
} from "./notes.core"

const TREE = ".agents/notes"

const PROPOSED = `# Agent Note: PDF export

Status: proposed

## Problem
Users copy tables by hand.

## Proposal
Add an export button.

## Alternatives considered
None were weighed.

## Acceptance criteria
- The button downloads a PDF (smoke test).

## Risks
A new dependency.
`

const IMPLEMENTED = `# Agent Note: Events between contexts

Status: implemented

## Problem
Contexts called each other over HTTP.

## Decision
Contexts publish events.

## Alternatives considered
**Direct calls** coupled deploys.

## Consequences
Eventual consistency.
`

const ARCHIVED = IMPLEMENTED.replace(
  "Status: implemented\n",
  "Status: implemented\nArchived: 2026-10-01\n",
)

type Fixture = Partial<NotesInput> & { readonly md: Record<string, string> }

const input = ({ md, ...extra }: Fixture): NotesInput => ({
  files: Object.keys(md),
  texts: new Map(Object.entries(md)),
  hashes: new Map(),
  manifests: new Map(),
  ...extra,
})

const errorsOf = (fixture: Fixture) => runNotes(input(fixture)).errors

describe("findTrees", () => {
  it("finds the root tree and context trees, not look-alikes", () => {
    expect(
      findTrees([
        ".agents/notes/README.md",
        "src/billing/.agents/notes/proposed/feature/2026-01-01-x.md",
        "src/x.agents/notes/README.md",
        "README.md",
      ]),
    ).toEqual([".agents/notes", "src/billing/.agents/notes"])
  })
})

describe("checkStructure", () => {
  const errors = (rels: string[]) => checkStructure({ tree: TREE, rels }).errors

  it("accepts the layout and reads the date from the filename", () => {
    const out = checkStructure({
      tree: TREE,
      rels: ["README.md", "proposed/feature/2026-09-29-pdf-export.md", "archived/manifest.json"],
    })
    expect(out.errors).toEqual([])
    expect(out.notes).toEqual([
      {
        tree: TREE,
        lifecycle: "proposed",
        rel: "proposed/feature/2026-09-29-pdf-export.md",
        date: "2026-09-29",
      },
    ])
  })

  it("rejects an index, unknown folders, wrong depth and bad filenames", () => {
    expect(errors(["INDEX.md"])[0]).toContain("no central index")
    expect(errors(["drafts/feature/2026-01-01-x.md"])[0]).toContain(
      'unknown lifecycle folder "drafts"',
    )
    expect(errors(["proposed/refactor/2026-01-01-x.md"])[0]).toContain(
      'unknown class folder "refactor"',
    )
    expect(errors(["proposed/feature/x/2026-01-01-x.md"])[0]).toContain("got depth 4")
    expect(errors(["proposed/feature/pdf-export.md"])[0]).toContain("yyyy-mm-dd-kebab-topic.md")
    expect(errors(["proposed/note.md"])[0]).toContain("expected proposed/{class}")
  })
})

describe("checkFormat", () => {
  const note = (lifecycle: string) => ({
    tree: TREE,
    lifecycle,
    rel: `${lifecycle}/feature/2026-01-01-x.md`,
    date: "2026-01-01",
  })

  it("accepts a well-formed proposal and implemented note", () => {
    expect(checkFormat({ note: note("proposed"), text: PROPOSED })).toEqual([])
    expect(checkFormat({ note: note("implemented"), text: IMPLEMENTED })).toEqual([])
  })

  it("fails a Status line that disagrees with the folder", () => {
    expect(checkFormat({ note: note("implemented"), text: PROPOSED }).join("\n")).toContain(
      "line 3 must be `Status: implemented`",
    )
  })

  it("fails a promotion that only changed the status word", () => {
    const text = PROPOSED.replace("Status: proposed", "Status: implemented")
    const errors = checkFormat({ note: note("implemented"), text }).join("\n")
    expect(errors).toContain("`## Proposal` is a proposal-era heading")
    expect(errors).toContain("missing the required `## Decision` section")
  })

  it("requires Alternatives considered and Problem first", () => {
    const text = IMPLEMENTED.replace("## Alternatives considered\n", "").replace(
      "## Problem\n",
      "## Context\n",
    )
    const errors = checkFormat({ note: note("implemented"), text }).join("\n")
    expect(errors).toContain("missing `## Alternatives considered`")
    expect(errors).toContain("the first section must be `## Problem`")
  })

  it("accepts a rejected note with its reason, and ignores headings in code fences", () => {
    const text = PROPOSED.replace("Status: proposed", "Status: rejected — too costly").concat(
      "\n```md\nStatus: proposed\n## Decision\n```\n",
    )
    expect(checkFormat({ note: note("rejected"), text })).toEqual([])
    const bare = PROPOSED.replace("Status: proposed", "Status: rejected")
    expect(checkFormat({ note: note("rejected"), text: bare })).toHaveLength(1)
  })
})

describe("relativeLinks and normalize", () => {
  it("keeps relative targets and drops URLs, anchors and inline code", () => {
    const text = "[a](../b.md#x) [c](https://x.y) [d](#top) `[e](f.md)` [g](</h i.md>)"
    expect(relativeLinks(text)).toEqual(["../b.md"])
  })

  it("normalizes like posix and keeps escapes visible", () => {
    expect(normalize(".agents/notes/proposed/feature/../../implemented/x.md")).toBe(
      ".agents/notes/implemented/x.md",
    )
    expect(normalize("a/../../b")).toBe("../b")
  })

  it("is idempotent", () => {
    const path = fc.array(fc.constantFrom("a", "b", ".", "..", ""), { maxLength: 8 })
    fc.assert(
      fc.property(path, (segs) => {
        const once = normalize(segs.join("/"))
        expect(normalize(once)).toBe(once)
      }),
    )
  })
})

describe("runNotes", () => {
  const proposed = `${TREE}/proposed/feature/2026-09-29-pdf-export.md`
  const implemented = `${TREE}/implemented/architecture/2026-06-11-events.md`

  it("passes a clean tree and counts its notes", () => {
    const out = runNotes(input({ md: { [`${TREE}/README.md`]: "# rules", [proposed]: PROPOSED } }))
    expect(out.errors).toEqual([])
    expect([out.noteCount, out.treeCount]).toEqual([1, 1])
  })

  it("passes a repo with no notes at all", () => {
    expect(runNotes(input({ md: { "README.md": "# app" } })).errors).toEqual([])
  })

  it("checks links out of active notes and into notes from any Markdown file", () => {
    const linking = PROPOSED.replace(
      "Add an export button.",
      "See [events](../../implemented/architecture/2026-06-11-events.md) and [gone](../../implemented/feature/2026-01-01-gone.md).",
    )
    expect(errorsOf({ md: { [proposed]: linking, [implemented]: IMPLEMENTED } })).toEqual([
      `links: ${proposed}: broken link to ../../implemented/feature/2026-01-01-gone.md`,
    ])
    expect(
      errorsOf({
        md: {
          "docs/a.md":
            "[old](../.agents/notes/proposed/feature/2026-01-01-moved.md) [x](missing.md)",
        },
      }),
    ).toEqual([
      "links: docs/a.md: broken link to ../.agents/notes/proposed/feature/2026-01-01-moved.md",
    ])
  })

  it("accepts a link to a directory", () => {
    expect(
      errorsOf({ md: { "AGENTS.md": "[notes](.agents/notes)", [proposed]: PROPOSED } }),
    ).toEqual([])
  })

  describe("archive", () => {
    const archived = `${TREE}/archived/architecture/2026-06-11-events.md`
    const hashes = new Map([[archived, "sha256:aaa"]])
    const sealedManifest: Manifest = {
      version: 1,
      files: { "architecture/2026-06-11-events.md": "sha256:aaa" },
    }

    it("asks for a seal, then offers the manifest to write", () => {
      const out = runNotes(input({ md: { [archived]: ARCHIVED }, hashes }))
      expect(out.errors).toHaveLength(1)
      expect(out.errors.filter(blocksSeal)).toEqual([])
      expect(afterSeal(out.errors)).toEqual([])
      expect(out.sealed.get(TREE)).toEqual(sealedManifest)
    })

    it("passes a sealed, unchanged archive", () => {
      const manifests = new Map([[TREE, sealedManifest]])
      expect(errorsOf({ md: { [archived]: ARCHIVED }, hashes, manifests })).toEqual([])
    })

    it("refuses an edited, moved or malformed archived note", () => {
      const manifests = new Map([[TREE, sealedManifest]])
      const edited = errorsOf({
        md: { [archived]: ARCHIVED },
        hashes: new Map([[archived, "sha256:bbb"]]),
        manifests,
      })
      expect(edited[0]).toContain("a sealed note was edited")
      expect(edited.filter(blocksSeal)).toHaveLength(1)
      expect(errorsOf({ md: { [`${TREE}/README.md`]: "" }, manifests })[0]).toContain(
        "was moved or deleted",
      )
      expect(errorsOf({ md: { [archived]: IMPLEMENTED }, hashes, manifests })[0]).toContain(
        "line 4 must be `Archived: YYYY-MM-DD`",
      )
      expect(
        errorsOf({ md: { [archived]: ARCHIVED }, hashes, manifests: new Map([[TREE, undefined]]) }),
      ).toEqual([`archive: ${TREE}/archived/manifest.json is not a valid manifest`])
    })
  })
})

describe("parseManifest", () => {
  it("accepts a map of hashes and rejects anything else", () => {
    expect(parseManifest({ version: 1, files: { "a/b.md": "sha256:x" } })).toEqual({
      version: 1,
      files: { "a/b.md": "sha256:x" },
    })
    expect(parseManifest({ files: { "a/b.md": 1 } })).toBeUndefined()
    expect(parseManifest(null)).toBeUndefined()
  })
})
