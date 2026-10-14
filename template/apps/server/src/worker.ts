/**
 * Composition root: the Cloudflare Workers entry. Builds the app once per isolate from the env
 * (typed config + the D1 binding). Static assets are served by Workers before this runs; only
 * /api/* reaches it (see wrangler.jsonc).
 */
import { buildApp } from "./api"
import { decodeConfig } from "./platform/config"
import { makeAppRuntime } from "./platform/runtime"
import { type D1Like, d1Sql } from "./platform/sql.d1"

interface Env {
  readonly DB: D1Like
}

let app: ReturnType<typeof buildApp> | undefined

export default {
  fetch: (request: Request, env: Env) => {
    app ??= buildApp(makeAppRuntime({ config: decodeConfig(env), db: d1Sql(env.DB) }))
    return app.fetch(request)
  },
}
