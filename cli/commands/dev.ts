/**
 * `axioms dev [--port <n>] [--persist-to <dir>]`: run the worker (`wrangler dev`) and the web app
 * (vite) side by side. vite serves the app and proxies /api to wrangler. Without flags they keep
 * the fixed ports (5173, 8787) and wrangler's default D1 state. With `--port`, the app takes that
 * port (0: a free one) and wrangler a free one; with `--persist-to`, the migrations and the worker
 * use that directory. Parallel agents, worktrees and CI each get their own server and state.
 * `bun --filter` cannot do this: web depends on server, so it waits for server's `dev` to exit,
 * which it never does. Ctrl-C stops both, and when one exits on its own (a crash, a port in use)
 * the other is stopped too, so a half-running dev setup never sits there looking healthy.
 */
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { devPorts, localUrl } from "../devserver.core"
import { applyMigrations, freePorts, startService, startWrangler, waitForHealth } from "./devserver"

export const dev = async (input: {
  readonly root: string
  readonly port: number | undefined
  readonly persistTo: string | undefined
}): Promise<boolean> => {
  const server = join(input.root, "apps", "server")
  const web = join(input.root, "apps", "web")
  const persistTo = input.persistTo === undefined ? undefined : resolve(input.persistTo)
  const [first = 0, second = 0, inspectorPort = 0] = freePorts(3)
  const ports = devPorts({ requested: input.port, free: [first, second] })
  const url = localUrl(ports.web)
  const apiUrl = localUrl(ports.api)

  // wrangler serves apps/web/dist as the Worker's assets and refuses to start without the folder;
  // in dev the app comes from vite, so an empty folder is enough until the first build.
  await mkdir(join(web, "dist"), { recursive: true })
  if (!(await applyMigrations({ server, persistTo, sink: undefined }))) {
    console.error("✖ dev: the D1 migrations did not apply")
    return false
  }

  const services = [
    startWrangler({ server, port: ports.api, inspectorPort, persistTo, output: "inherit" }),
    startService({
      cmd: ["bun", "run", "dev"],
      cwd: web,
      env: { WEB_PORT: String(ports.web), API_URL: apiUrl },
      output: "inherit",
    }),
  ]
  const stopAll = () => Promise.all(services.map((service) => service.stop()))
  const alive = () => services.every((service) => service.proc.exitCode === null)
  for (const service of services) void service.proc.exited.then(stopAll)

  console.error(
    `axioms dev: app on ${url} (wrangler dev on ${apiUrl}, D1 state in ${persistTo ?? "wrangler's default .wrangler/state"})`,
  )
  if (await waitForHealth({ url, alive })) console.error(`✓ dev: ready on ${url}`)
  else if (alive()) console.error(`✖ dev: ${url}/api/health has not answered 200 within 60s`)

  const codes = await Promise.all(services.map((service) => service.proc.exited))
  await stopAll()
  return codes.every((code) => code === 0)
}
