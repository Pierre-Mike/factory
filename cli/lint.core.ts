/**
 * Reads the lint gate's Biome report. `axioms check` runs `biome ci --reporter=json` first; when
 * every finding is one `bun run lint` (`biome check --write`) fixes, the gate prints the file names
 * and the fix command instead of Biome's per-character formatter diff, which agents cannot read.
 */

export interface LintDiagnostic {
  readonly category: string
  readonly path: string
  readonly severity: string
}

export interface LintReport {
  readonly diagnostics: ReadonlyArray<LintDiagnostic>
  /** Diagnostics Biome counted but left out of the report (its --max-diagnostics cap). */
  readonly notPrinted: number
}

export interface LintClassification {
  /** Files with findings `--write` fixes (formatting, assist actions such as import sorting). */
  readonly fixable: ReadonlyArray<string>
  /** Something else was found, or may have been: the full diagnostics must be shown. */
  readonly othersFound: boolean
}

/** File names listed before the rest are summed up as "… and N more". */
export const MAX_LISTED_FILES = 20

const FIX_COMMAND = "bun run lint"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const toDiagnostic = (value: unknown): LintDiagnostic | null => {
  if (!isRecord(value) || !isRecord(value.location)) return null
  const { category, severity } = value
  const { path } = value.location
  return typeof category === "string" && typeof severity === "string" && typeof path === "string"
    ? { category, path, severity }
    : null
}

/** Biome's `--reporter=json` document, or null when the text holds none (a crash, a bad config). */
export const parseBiomeJson = (text: string): LintReport | null => {
  const start = text.indexOf("{")
  if (start === -1) return null
  let doc: unknown
  try {
    doc = JSON.parse(text.slice(start))
  } catch {
    return null
  }
  if (!isRecord(doc) || !isRecord(doc.summary) || !Array.isArray(doc.diagnostics)) return null
  const diagnostics = doc.diagnostics.map(toDiagnostic)
  if (diagnostics.some((d) => d === null)) return null
  const notPrinted = doc.summary.diagnosticsNotPrinted
  return {
    diagnostics: diagnostics.filter((d): d is LintDiagnostic => d !== null),
    notPrinted: typeof notPrinted === "number" ? notPrinted : 0,
  }
}

const isWriteFixable = (category: string): boolean =>
  category === "format" || category.startsWith("assist/")

export const classifyLint = (report: LintReport): LintClassification => {
  const fixable = new Set<string>()
  let othersFound = report.notPrinted > 0
  for (const d of report.diagnostics) {
    if (isWriteFixable(d.category)) fixable.add(d.path)
    else othersFound = true
  }
  return { fixable: [...fixable].sort(), othersFound }
}

/** The lines the lint gate prints in place of Biome's diffs for files `--write` fixes. */
export const writeFixableReport = (input: {
  readonly files: ReadonlyArray<string>
  readonly othersFound: boolean
}): ReadonlyArray<string> => {
  const count = input.files.length
  const listed = input.files.slice(0, MAX_LISTED_FILES).map((file) => `  ${file}`)
  const more = count > MAX_LISTED_FILES ? [`  … and ${count - MAX_LISTED_FILES} more`] : []
  return [
    `✖ ${count} ${count === 1 ? "file needs" : "files need"} formatting, which \`${FIX_COMMAND}\` fixes:`,
    ...listed,
    ...more,
    input.othersFound
      ? `  run \`${FIX_COMMAND}\` to fix them; the other findings follow`
      : `  run \`${FIX_COMMAND}\` to fix`,
  ]
}

/** ANSI color only reaches a terminal; a pipe or an agent's captured output gets plain text. */
export const biomeColorArgs = (input: {
  readonly stdoutTTY: boolean
  readonly stderrTTY: boolean
}): ReadonlyArray<string> => (input.stdoutTTY && input.stderrTTY ? [] : ["--colors=off"])
