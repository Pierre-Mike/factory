/**
 * The shared rules live in harness/canon.md. A project's AGENTS.md holds a copy between two
 * markers so every agent loads them; `axioms sync` rewrites the copy and `axioms doctor` fails
 * when it differs from the installed harness. Text outside the markers belongs to the project.
 */
export const CANON_START = "<!-- axioms:start -->"
export const CANON_END = "<!-- axioms:end -->"

const block = (canon: string) => `${CANON_START}\n${canon.trim()}\n${CANON_END}`

export const extractCanon = (agentsMd: string): string | undefined => {
  const start = agentsMd.indexOf(CANON_START)
  const end = agentsMd.indexOf(CANON_END)
  if (start === -1 || end === -1 || end < start) return undefined
  return agentsMd.slice(start + CANON_START.length, end).trim()
}

/** Replace the canon block, or append one when the file has none. */
export const writeCanon = (input: {
  readonly agentsMd: string
  readonly canon: string
}): string => {
  const start = input.agentsMd.indexOf(CANON_START)
  const end = input.agentsMd.indexOf(CANON_END)
  if (start === -1 || end === -1 || end < start) {
    const head = input.agentsMd.trimEnd()
    return `${head === "" ? "" : `${head}\n\n`}${block(input.canon)}\n`
  }
  return `${input.agentsMd.slice(0, start)}${block(input.canon)}${input.agentsMd.slice(end + CANON_END.length)}`
}
