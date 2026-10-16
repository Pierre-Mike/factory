import { describe, expect, it } from "bun:test"
import { ciCdChanges, jobEnv, planWorkflow } from "./dryrun.core"

describe("jobEnv", () => {
  it("keeps what tools need to start, drops everything else, and sets CI", () => {
    expect(
      jobEnv({
        PATH: "/bin",
        HOME: "/h",
        CLOUDFLARE_API_TOKEN: "secret",
        DEBUG: "1",
        TERM: undefined,
      }),
    ).toEqual({ PATH: "/bin", HOME: "/h", CI: "true" })
  })
})

describe("ciCdChanges", () => {
  it("keeps the files that can break CI or a deploy", () => {
    expect(
      ciCdChanges([
        ".github/workflows/ci.yml",
        "package.json",
        "apps/server/package.json",
        "bun.lock",
        "apps/server/wrangler.jsonc",
        "apps/server/migrations/0002_photos.sql",
        "apps/web/vite.config.ts",
        "apps/server/src/features/items/items.core.ts",
        "README.md",
      ]),
    ).toEqual([
      ".github/workflows/ci.yml",
      "package.json",
      "apps/server/package.json",
      "bun.lock",
      "apps/server/wrangler.jsonc",
      "apps/server/migrations/0002_photos.sql",
      "apps/web/vite.config.ts",
    ])
  })

  it("lets a code-only push skip the dry run", () => {
    expect(ciCdChanges(["apps/web/src/styles.css", "shared/src/item.ts"])).toEqual([])
  })
})

const workflow = (steps: unknown[]) => ({ jobs: { check: { "runs-on": "ubuntu-latest", steps } } })

describe("planWorkflow", () => {
  it("replays run steps and stands in for checkout and setup-bun", () => {
    const plan = planWorkflow({
      workflow: workflow([
        { uses: "actions/checkout@abc", with: { "persist-credentials": false } },
        { uses: "oven-sh/setup-bun@def", with: { "bun-version": "1.3.6" } },
        { run: "bun install --frozen-lockfile" },
        { name: "build", run: "bun run build", "working-directory": "apps/web" },
      ]),
      localBun: "1.3.6",
    })
    expect(plan.unsupported).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(plan.jobs[0]?.steps).toEqual([
      {
        kind: "provided",
        name: "actions/checkout@abc",
        reason: "the clean clone of HEAD is the checkout",
      },
      { kind: "provided", name: "oven-sh/setup-bun@def", reason: "uses the local bun" },
      {
        kind: "run",
        name: "bun install --frozen-lockfile",
        run: "bun install --frozen-lockfile",
        cwd: ".",
      },
      { kind: "run", name: "build", run: "bun run build", cwd: "apps/web" },
    ])
  })

  it("warns when CI pins a different bun", () => {
    const plan = planWorkflow({
      workflow: workflow([{ uses: "oven-sh/setup-bun@x", with: { "bun-version": "1.3.6" } }]),
      localBun: "1.3.9",
    })
    expect(plan.warnings).toEqual([
      "check › oven-sh/setup-bun@x: CI pins bun 1.3.6, local bun is 1.3.9",
    ])
    expect(plan.unsupported).toEqual([])
  })

  it("refuses what it cannot reproduce, so the dry run fails instead of passing blind", () => {
    const plan = planWorkflow({
      workflow: workflow([
        { uses: "someone/deploy-action@v1" },
        // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a JS template
        { run: "echo ${{ secrets.TOKEN }}" },
        { if: "github.event_name == 'push'", run: "bun run deploy" },
        { name: "empty" },
      ]),
      localBun: "1.3.6",
    })
    expect(plan.unsupported).toHaveLength(4)
  })

  it("refuses env, shell and defaults at any level, which the replay would ignore", () => {
    const plan = planWorkflow({
      workflow: {
        env: { FORCE_COLOR: "1" },
        defaults: { run: { "working-directory": "apps/server" } },
        jobs: {
          check: {
            env: { NODE_ENV: "test" },
            steps: [
              { run: "bun test", env: { DEBUG: "1" } },
              { run: "bun test", shell: "sh" },
            ],
          },
        },
      },
      localBun: "1",
    })
    expect(plan.unsupported).toEqual([
      "workflow: env, defaults would be ignored, so it is not simulated",
      "check: env would be ignored, so it is not simulated",
      "check › bun test: env would be ignored, so it is not simulated",
      "check › bun test: shell would be ignored, so it is not simulated",
    ])
  })

  it("replays shell: bash and skips env: on a provided step, since both match CI", () => {
    const plan = planWorkflow({
      workflow: workflow([
        { uses: "actions/checkout@abc", env: { GIT_TRACE: "1" } },
        { run: "bun test", shell: "bash" },
      ]),
      localBun: "1",
    })
    expect(plan.unsupported).toEqual([])
    expect(plan.jobs[0]?.steps).toHaveLength(2)
  })

  it("refuses an empty or malformed workflow", () => {
    expect(planWorkflow({ workflow: null, localBun: "1" }).unsupported).toEqual([
      "the workflow has no jobs",
    ])
    expect(
      planWorkflow({ workflow: { jobs: { t: { strategy: {}, steps: [] } } }, localBun: "1" })
        .unsupported,
    ).toHaveLength(1)
  })
})
