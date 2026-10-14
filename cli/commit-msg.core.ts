/**
 * Conventional-commit check, pure. One regex is the whole spec: release tooling and agents read
 * the history, so the subject line has to be machine-parsable.
 */
const CONVENTIONAL =
  /^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([a-z0-9./-]+\))?!?: .{1,72}$/
const EXEMPT = /^(Merge |Revert |fixup! |squash! |Initial commit)/

export const isConventionalSubject = (message: string): boolean => {
  const firstLine = message.split("\n")[0] ?? ""
  return EXEMPT.test(firstLine) || CONVENTIONAL.test(firstLine)
}
