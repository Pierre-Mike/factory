/**
 * Conventional-commit check, pure. Release tooling and agents read the history, so the subject line
 * has to be machine-parsable. The length limit is generous on purpose: a subject that says enough
 * beats a short one, and the cap only stops a pasted paragraph.
 */
export const MAX_SUBJECT_LENGTH = 150

const CONVENTIONAL =
  /^(feat|fix|docs|chore|refactor|perf|test|build|ci|style|revert)(\([a-z0-9./-]+\))?!?: \S/
const EXEMPT = /^(Merge |Revert |fixup! |squash! |Initial commit)/

/** Why the first line is rejected, or undefined when it is a valid subject. */
export const commitSubjectProblem = (message: string): string | undefined => {
  const subject = (message.split("\n")[0] ?? "").replace(/\r$/, "")
  if (EXEMPT.test(subject)) return undefined
  if (!CONVENTIONAL.test(subject)) {
    return `not a conventional commit subject: "${subject}"
  expected: type(scope)?: subject
  types: feat fix docs chore refactor perf test build ci style revert`
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return `the subject line is ${subject.length} characters; the limit is ${MAX_SUBJECT_LENGTH}. Move detail into the body.`
  }
  return undefined
}
