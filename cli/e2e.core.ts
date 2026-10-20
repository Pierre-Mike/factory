/**
 * Browser tests, pure: which files under apps/web/e2e are tests, and the commands `axioms e2e`
 * runs. They are named `*.e2e.ts` so `bun test` (and so `axioms check`) never discovers them; only
 * `axioms e2e`, which starts the server they need, runs them, by path.
 */

/** The folder, relative to apps/web, that holds the browser tests. */
export const E2E_DIR = "e2e"

const E2E_FILE = /^[^/]+\.e2e\.ts$/

export const e2eTestFiles = (entries: ReadonlyArray<string>): string[] =>
  entries.filter((entry) => E2E_FILE.test(entry)).sort()

/** A browser start and a page load can outlast bun's 5s default on a cold CI runner. */
const TEST_TIMEOUT_MS = 30_000

export const e2eTestCmd = (files: ReadonlyArray<string>): string[] => [
  "bun",
  "test",
  "--timeout",
  String(TEST_TIMEOUT_MS),
  ...files.map((file) => `./${E2E_DIR}/${file}`),
]

/**
 * Playwright's headless chromium, matching the pinned `playwright` version. A no-op once it is in
 * the cache (~/Library/Caches/ms-playwright, ~/.cache/ms-playwright).
 */
export const BROWSER_INSTALL_CMD = ["bunx", "playwright", "install", "chromium-headless-shell"]
