/**
 * Source of truth for harness/biome.shared.json and for the factory's own biome.json. Run
 * `bun run build:biome` after editing; a test fails when either committed config is stale.
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

const FETCH =
  "web: use the typed Hono RPC client (hc<AppType>). server: call external services from a *.io.ts service, where fetch is allowed."
const PROCESS =
  "The app runs on Cloudflare Workers, which has no process. Read configuration from the env object in platform/config.ts."
const BUN =
  "Bun is the dev toolchain, not the runtime. Bun APIs are allowed only in *.bun.ts adapters, tests, and tooling."

const BASE_GLOBALS = { fetch: FETCH, process: PROCESS, Bun: BUN }

/** Every global banned in some file shape. grit/no-global-alias.grit bans reaching each one by alias. */
export const CORE_GLOBALS = {
  ...BASE_GLOBALS,
  Date: "Functional core must not read the clock. Accept timestamps (epoch ms) as plain input from the shell.",
  performance:
    "Functional core must not read the clock. Accept timestamps (epoch ms) as plain input from the shell.",
  crypto:
    "Functional core must be deterministic. Generate ids and random values in the shell and pass them in.",
  Promise:
    "Functional core must stay synchronous. Do async work in *.io.ts and pass plain data in.",
  console: "Functional core must not perform I/O. Return values and let the shell log.",
  setTimeout: "Functional core must not schedule work. Keep it synchronous data-in/data-out.",
  setInterval: "Functional core must not schedule work. Keep it synchronous data-in/data-out.",
}

const AXIOS = {
  axios: { message: "Use the typed Hono RPC client (hc<AppType>) instead of axios." },
}

/** The `process` global is banned in app code; importing the module would walk past that ban. */
const APP_PATHS = {
  ...AXIOS,
  process: { message: PROCESS },
  "node:process": { message: PROCESS },
}

const BUN_IMPORTS = {
  group: ["bun", "bun:*"],
  message: BUN,
}

/**
 * A slice's internal files, by suffix. `../**` matches every path that leaves the slice folder,
 * however it is spelled (`../other/other.core`, `../../features/other/other.core`), and `./../**`
 * the same path with a leading `./`. Doors (`*.door`) stay importable.
 */
const SLICE_INTERNALS = ["core", "io", "routes", "queries", "route"]

const CROSS_SLICE = {
  group: SLICE_INTERNALS.flatMap((kind) => [`../**/*.${kind}`, `./../**/*.${kind}`]),
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

const EFFECT_RUNTIME_MODULES = ["Effect", "Layer", "Context", "ManagedRuntime", "Runtime"]
const EFFECT_RUNTIME_MESSAGE =
  "Functional core must stay pure: model failures as Result/Option/Data. The Effect runtime lives in *.io.ts and *.routes.ts. Result, Option, Data and Schema are allowed here."

const EFFECT_RUNTIME = {
  effect: { importNames: EFFECT_RUNTIME_MODULES, message: EFFECT_RUNTIME_MESSAGE },
}

/** The same modules reached through their subpaths (`import * as Effect from "effect/Effect"`). */
const EFFECT_RUNTIME_SUBPATHS = {
  group: EFFECT_RUNTIME_MODULES.map((name) => `effect/${name}`),
  message: EFFECT_RUNTIME_MESSAGE,
}

/** The `crypto` global is banned in the core; importing the module would walk past that ban. */
const CRYPTO_MODULE = { message: CORE_GLOBALS.crypto }
const CORE_PATHS = { crypto: CRYPTO_MODULE, "node:crypto": CRYPTO_MODULE }

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
/**
 * Tooling relaxes the global bans, so it must never match code that ships. Anything under `src/` is
 * app code whatever it is named: `src/scripts/x.ts` or `features/x/x.config.ts` keeps every rule.
 */
const APP_CODE = "**/src/**"
const TOOLING = [
  "**/scripts/**",
  "**/smoke/**",
  "**/*.config.ts",
  "**/worker-configuration.d.ts",
  `!${APP_CODE}`,
]

const TOOLING_LINTER = {
  rules: {
    suspicious: { noConsole: "off" },
    style: { ...globals({}), ...imports({ paths: AXIOS, patterns: [] }) },
  },
}

const sharedConfig = (pluginDir: string) => {
  const plugin = (name: string) => `${pluginDir}/${name}.grit`
  return {
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
          ...imports({ paths: APP_PATHS, patterns: [BUN_IMPORTS] }),
        },
      },
    },
    overrides: [
      {
        includes: ["**/*.ts", "**/*.tsx", ...TESTS.map((t) => `!${t}`)],
        plugins: [plugin("no-cast-json")],
      },
      {
        // Tooling is included on purpose: it may use the bare globals, so the alias is never needed.
        includes: ["**/*.ts", "**/*.tsx", ...TESTS.map((t) => `!${t}`), "!**/*.bun.ts"],
        plugins: [plugin("no-global-alias")],
      },
      {
        includes: ["**/features/**", "!**/*.core.ts", "!**/*.core.tsx"],
        ...style(imports({ paths: APP_PATHS, patterns: [BUN_IMPORTS, CROSS_SLICE] })),
      },
      {
        includes: ["**/*.core.ts", "**/*.core.tsx"],
        plugins: [
          plugin("no-throw-in-core"),
          plugin("no-await-in-core"),
          plugin("no-random-in-core"),
        ],
        ...style({
          ...globals(CORE_GLOBALS),
          ...imports({
            paths: { ...APP_PATHS, ...CORE_PATHS, ...EFFECT_RUNTIME },
            patterns: [BUN_IMPORTS, CROSS_SLICE, EFFECT_RUNTIME_SUBPATHS, ...CORE_IMPORT_PATTERNS],
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
          // APP_PATHS, not AXIOS: *.bun.ts ships under src/, so the process import stays banned.
          ...imports({ paths: APP_PATHS, patterns: [] }),
        }),
      },
      {
        // Only the edge files at the root of src/: a features/x/api.ts keeps noConsole.
        includes: ["**/src/worker.ts", "**/src/api.ts", "!**/src/*/**"],
        linter: { rules: { suspicious: { noConsole: "off" } } },
      },
      { includes: TOOLING, linter: TOOLING_LINTER },
    ],
  }
}

export const biomeConfig = sharedConfig(PLUGIN_DIR)

/**
 * The factory lints itself with the shared rules, loading the plugins from this checkout. Its CLI,
 * tests and generators run on Bun, so they are tooling; its `*.core.ts` files keep every core ban.
 */
const shared = sharedConfig("./harness/grit")
export const factoryBiomeConfig = {
  ...shared,
  $schema: "./node_modules/@biomejs/biome/configuration_schema.json",
  vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
  // The template is linted as a generated project by the selftest. `build:biome` formats this file
  // after writing it; the shared JSON is excluded instead, since projects only read it.
  files: { includes: ["**", "!template", "!harness/biome.shared.json"] },
  overrides: [
    ...shared.overrides,
    {
      includes: ["cli/**", "tests/**", "harness/**", "!**/*.core.ts"],
      linter: TOOLING_LINTER,
    },
  ],
}

const render = (config: object) => `${JSON.stringify(config, null, 2)}\n`

export const renderBiomeConfig = () => render(biomeConfig)

if (import.meta.main) {
  await Bun.write(new URL("./biome.shared.json", import.meta.url), renderBiomeConfig())
  await Bun.write(new URL("../biome.json", import.meta.url), render(factoryBiomeConfig))
  console.error("wrote harness/biome.shared.json and biome.json")
}
