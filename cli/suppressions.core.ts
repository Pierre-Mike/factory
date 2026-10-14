/**
 * No suppression comments in app code. A `biome-ignore` switches off any lint rule, and
 * `@ts-expect-error`/`@ts-expect-error`/`@ts-nocheck` switch off the type checker, so one comment would
 * defeat a gate. Tests may still use them, and generated files are skipped. Pure: takes file
 * contents, returns one line per suppression found.
 */
const DIRECTIVE =
  /(?:\/\/|\/\*|^\s*\*).*?(biome-ignore(?:-all|-start|-end)?|@ts-(?:ignore|expect-error|nocheck))\b/
const EXEMPT = /(\.(test|spec)\.tsx?|\.gen\.ts|(^|\/)worker-configuration\.d\.ts)$/

export interface SourceFile {
  readonly path: string
  readonly text: string
}

export const findSuppressions = (files: ReadonlyArray<SourceFile>): string[] =>
  files
    .filter((file) => !EXEMPT.test(file.path))
    .flatMap((file) =>
      file.text.split("\n").flatMap((line, index) => {
        const directive = line.match(DIRECTIVE)?.[1]
        return directive === undefined ? [] : [`${file.path}:${index + 1} ${directive}`]
      }),
    )
