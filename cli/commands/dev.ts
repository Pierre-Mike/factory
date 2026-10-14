/**
 * `axioms dev`: run the worker (`wrangler dev`, :8787) and the web app (vite, :5173) side by side.
 * `bun --filter` cannot do this: web depends on server, so it waits for server's `dev` to exit,
 * which it never does. Ctrl-C stops both.
 */
import { join } from "node:path"

export const dev = async (root: string): Promise<boolean> => {
  const procs = ["server", "web"].map((app) =>
    Bun.spawn(["bun", "run", "dev"], {
      cwd: join(root, "apps", app),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  )
  const stop = () => {
    for (const proc of procs) proc.kill("SIGINT")
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  const codes = await Promise.all(procs.map((proc) => proc.exited))
  return codes.every((code) => code === 0)
}
