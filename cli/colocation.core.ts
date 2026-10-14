/** Every functional core has a co-located test. Pure: takes the file list, returns what is missing. */
const CORE = /\.core\.(ts|tsx)$/

export const missingCoreTests = (files: ReadonlyArray<string>): string[] => {
  const present = new Set(files)
  return files
    .filter((file) => CORE.test(file))
    .map((file) => ({ file, test: file.replace(CORE, ".core.test.$1") }))
    .filter(({ test }) => !present.has(test))
    .map(({ file, test }) => `${file} -> expected ${test}`)
}
