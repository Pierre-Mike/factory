/**
 * Process helpers for the selftest: watch every process a command starts, then name the ones still
 * running after it exits. A tree is sampled by parent pid while it runs, so a workerd that outlives
 * its wrangler (and is re-parented to init) is still on the list. Scoped to one command's tree,
 * never `pgrep workerd`, so other wrangler servers on the machine do not count.
 */
import type { Subprocess } from "bun"

const childrenByParent = (): Map<number, number[]> => {
  const out = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="]).stdout.toString()
  const children = new Map<number, number[]>()
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (pid === undefined || ppid === undefined || Number.isNaN(pid)) continue
    children.set(ppid, [...(children.get(ppid) ?? []), pid])
  }
  return children
}

/** Sample the descendants of `pid` every 200ms until `stop()`, which returns every pid seen. */
export const watchTree = (pid: number) => {
  const seen = new Set<number>()
  let watching = true
  const sample = () => {
    const children = childrenByParent()
    const queue = [pid, ...seen]
    while (queue.length > 0) {
      for (const child of children.get(queue.pop() ?? -1) ?? []) {
        if (!seen.has(child)) {
          seen.add(child)
          queue.push(child)
        }
      }
    }
  }
  const loop = (async () => {
    while (watching) {
      sample()
      await Bun.sleep(200)
    }
  })()
  return {
    stop: async (): Promise<ReadonlySet<number>> => {
      watching = false
      await loop
      return seen
    },
  }
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** The pids still running after a 1s grace period, as `ps` lines; empty when all are gone. */
export const survivors = async (pids: ReadonlySet<number>): Promise<string> => {
  await Bun.sleep(1_000)
  const alive = [...pids].filter(isAlive)
  if (alive.length === 0) return ""
  return Bun.spawnSync(["ps", "-o", "pid=,command=", "-p", alive.join(",")]).stdout.toString()
}

/** Drain a child's stdout and stderr into one buffer, and wait for a line that matches. */
export const collectOutput = (proc: Subprocess<"ignore" | "inherit", "pipe", "pipe">) => {
  let text = ""
  const decoder = new TextDecoder()
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) text += decoder.decode(chunk, { stream: true })
  }
  const done = Promise.all([drain(proc.stdout), drain(proc.stderr)])
  return {
    text: () => text,
    done,
    /** The first match of `pattern` within 120s, or undefined once the time is up or the child exits. */
    waitFor: async (pattern: RegExp): Promise<RegExpMatchArray | undefined> => {
      const deadline = performance.now() + 120_000
      while (performance.now() < deadline) {
        const match = text.match(pattern)
        if (match !== null) return match
        if (proc.exitCode !== null) return undefined
        await Bun.sleep(200)
      }
      return undefined
    },
  }
}

/** The status `url` answers, retrying for up to 60s while it is not reachable or not 200. */
export const pollStatus = async (url: string): Promise<number | string> => {
  const deadline = performance.now() + 60_000
  let last: number | string = "no answer"
  while (performance.now() < deadline) {
    try {
      const res = await fetch(url)
      last = res.status
      if (res.ok) return res.status
    } catch (error) {
      last = String(error)
    }
    await Bun.sleep(500)
  }
  return last
}
