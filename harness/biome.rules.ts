/**
 * Source of truth for harness/biome.shared.json. Run `bun run build:biome` after editing; a test fails
 * when the committed JSON is stale.
 *
 * Why a generator: a Biome override that sets a rule's options REPLACES the base options for that
 * rule, it does not merge them. Hand-written overrides therefore drop global denials (the
 * template's `*.core.ts` override silently re-allowed `axios`). Here every override is built from
 * the same deny sets, so a denial added once applies to every file shape.
 *
 * Enforcement attaches to file shape (`**\/*.core.ts`, `**\/*.io.ts`, `**\/features/**`), never to a
 * location, so renaming an app cannot switch a rule off. Overrides are ordered: when two match the
 * same file and set the same rule, the later one wins (tests after features, for example).
 */

/** Plugin paths resolve from the consuming project's root, not from this file. */
const PLUGIN_DIR = "./node_modules/@pierre-mike/axioms/harness/grit"
const plugin = (name: string) => `${PLUGIN_DIR}/${name}.grit`

const FETCH =
  "web: use the typed Hono RPC client (hc<AppType>). server: call external services from a *.io.ts service, where fetch is allowed."
const PROCESS =
  "The app runs on Cloudflare Workers, which has no process. Read configuration from the env object in platform/config.ts."
const BUN =
  "Bun is the dev toolchain, not the runtime. Bun APIs are allowed only in *.bun.ts adapters, tests, and tooling."

const BASE_GLOBALS = { fetch: FETCH, process: PROCESS, Bun: BUN }

const CORE_GLOBALS = {
  ...BASE_GLOBALS,
  Date: "Functional core must not read the clock. Accept timestamps (epoch ms) as plain input from the shell.",
  Promise:
    "Functional core must stay synchronous. Do async work in *.io.ts and pass plain data in.",
  console: "Functional core must not perform I/O. Return values and let the shell log.",
  setTimeout: "Functional core must not schedule work. Keep it synchronous data-in/data-out.",
  setInterval: "Functional core must not schedule work. Keep it synchronous data-in/data-out.",
}

const AXIOS = {
  axios: { message: "Use the typed Hono RPC client (hc<AppType>) instead of axios." },
}

const BUN_IMPORTS = {
  group: ["bun", "bun:*"],
  message: BUN,
}

const CROSS_SLICE = {
  group: ["../*/*.core", "../*/*.io", "../*/*.routes", "../*/*.queries", "../*/*.route"],
  message:
    "A feature slice must not reach into a sibling slice's internals. Import its published door (<feature>.door.ts) instead.",
}

const CORE_IMPORT_PATTERNS = [
  {
    group: ["**/*.io", "**/*.io.ts", "./*.io", "../**/*.io"],
    message:
      "Functional core must not import an I/O service (*.io). Wire I/O in *.routes.ts and pass plain data in.",
  },
  {
    group: ["**/*.door", "**/*.door.ts", "./*.door", "../**/*.door"],
    message:
      "A door re-exports a service Tag, which would pull the Effect runtime into pure code. Consume doors from *.routes.ts or *.io.ts.",
  },
]

const EFFECT_RUNTIME = {
  effect: {
    importNames: ["Effect", "Layer", "Context", "ManagedRuntime", "Runtime"],
    message:
      "Functional core must stay pure: model failures as Either/Option/Data. The Effect runtime lives in *.io.ts and *.routes.ts. Either, Option, Data and Schema are allowed here.",
  },
}

const globals = (denied: Record<string, string>) => ({
  noRestrictedGlobals: { level: "error", options: { deniedGlobals: denied } },
})

const imports = (input: { paths: object; patterns: object[] }) => ({
  noRestrictedImports: {
    level: "error",
    options: {
      paths: input.paths,
      ...(input.patterns.length > 0 ? { patterns: input.patterns } : {}),
    },
  },
})

const style = (rules: object) => ({ linter: { rules: { style: rules } } })

const TESTS = ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"]
const TOOLING = ["**/scripts/**", "**/smoke/**", "**/*.config.ts", "**/worker-configuration.d.ts"]

export const biomeConfig = {
  $schema: "https://biomejs.dev/schemas/2.4.16/schema.json",
  formatter: { enabled: true, indentStyle: "space", indentWidth: 2, lineWidth: 100 },
  javascript: {
    formatter: { quoteStyle: "double", semicolons: "asNeeded", trailingCommas: "all" },
  },
  plugins: [plugin("max-one-param-declarations")],
  linter: {
    enabled: true,
    rules: {
      recommended: true,
      suspicious: {
        noExplicitAny: "error",
        noConsole: { level: "error", options: { allow: ["error", "warn"] } },
      },
      style: {
        useConst: "error",
        ...globals(BASE_GLOBALS),
        ...imports({ paths: AXIOS, patterns: [BUN_IMPORTS] }),
      },
    },
  },
  overrides: [
    {
      includes: ["**/*.ts", "**/*.tsx", ...TESTS.map((t) => `!${t}`)],
      plugins: [plugin("no-cast-json")],
    },
    {
      includes: ["**/features/**", "!**/*.core.ts", "!**/*.core.tsx"],
      ...style(imports({ paths: AXIOS, patterns: [BUN_IMPORTS, CROSS_SLICE] })),
    },
    {
      includes: ["**/*.core.ts", "**/*.core.tsx"],
      plugins: [plugin("no-throw-in-core"), plugin("no-await-in-core")],
      ...style({
        ...globals(CORE_GLOBALS),
        ...imports({
          paths: { ...AXIOS, ...EFFECT_RUNTIME },
          patterns: [BUN_IMPORTS, CROSS_SLICE, ...CORE_IMPORT_PATTERNS],
        }),
      }),
    },
    {
      includes: ["**/*.io.ts"],
      ...style(globals({ process: PROCESS, Bun: BUN })),
    },
    {
      includes: ["**/*.bun.ts", ...TESTS],
      ...style({
        ...globals({ fetch: FETCH, process: PROCESS }),
        ...imports({ paths: AXIOS, patterns: [] }),
      }),
    },
    {
      includes: ["**/worker.ts", "**/api.ts"],
      linter: { rules: { suspicious: { noConsole: "off" } } },
    },
    {
      includes: TOOLING,
      linter: {
        rules: {
          suspicious: { noConsole: "off" },
          style: { ...globals({}), ...imports({ paths: AXIOS, patterns: [] }) },
        },
      },
    },
  ],
}

export const renderBiomeConfig = () => `${JSON.stringify(biomeConfig, null, 2)}\n`

if (import.meta.main) {
  await Bun.write(new URL("./biome.shared.json", import.meta.url), renderBiomeConfig())
  console.error("wrote harness/biome.shared.json")
}
