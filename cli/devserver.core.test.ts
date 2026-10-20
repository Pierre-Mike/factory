import { describe, expect, it } from "bun:test"
import fc from "fast-check"
import {
  DEFAULT_PORTS,
  DEV_USAGE,
  devPorts,
  localUrl,
  migrationsCmd,
  parseDevArgs,
  wranglerDevCmd,
} from "./devserver.core"

describe("parseDevArgs", () => {
  it("defaults to no port and no persist directory", () => {
    expect(parseDevArgs([])).toEqual({ ok: true, port: undefined, persistTo: undefined })
  })

  it("reads --port and --persist-to", () => {
    expect(parseDevArgs(["--port", "0", "--persist-to", "/tmp/a"])).toEqual({
      ok: true,
      port: 0,
      persistTo: "/tmp/a",
    })
    expect(parseDevArgs(["--persist-to", "state", "--port", "3001"])).toEqual({
      ok: true,
      port: 3001,
      persistTo: "state",
    })
  })

  it("accepts every port from 0 to 65535", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 65535 }), (port) => {
        expect(parseDevArgs(["--port", String(port)])).toEqual({
          ok: true,
          port,
          persistTo: undefined,
        })
      }),
    )
  })

  it("refuses a port that is not a whole number in range", () => {
    for (const bad of ["-1", "65536", "1.5", "abc", "", "0x10", " 80"]) {
      const parsed = parseDevArgs(["--port", bad])
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toContain(DEV_USAGE)
    }
  })

  it("refuses a flag without its value, an unknown argument, or a repeated flag", () => {
    for (const args of [
      ["--port"],
      ["--persist-to"],
      ["--persist-to", "--port"],
      ["--host", "x"],
      ["8787"],
      ["--port", "1", "--port", "2"],
    ]) {
      expect(parseDevArgs(args).ok).toBe(false)
    }
  })
})

describe("devPorts", () => {
  it("keeps the fixed ports when no port is asked for", () => {
    expect(devPorts({ requested: undefined, free: [4001, 4002] })).toEqual(DEFAULT_PORTS)
    expect(DEFAULT_PORTS).toEqual({ web: 5173, api: 8787 })
  })

  it("serves the app on the asked port and wrangler on a free one", () => {
    expect(devPorts({ requested: 3001, free: [4001, 4002] })).toEqual({ web: 3001, api: 4002 })
  })

  it("picks a free port for the app when asked for port 0", () => {
    expect(devPorts({ requested: 0, free: [4001, 4002] })).toEqual({ web: 4001, api: 4002 })
  })
})

describe("wrangler commands", () => {
  it("runs wrangler dev on loopback with the development environment", () => {
    expect(
      wranglerDevCmd({ port: 8801, inspectorPort: 9301, persistTo: ".wrangler/smoke" }),
    ).toEqual([
      "bunx",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      "8801",
      "--inspector-port",
      "9301",
      "--persist-to",
      ".wrangler/smoke",
      "--var",
      "ENVIRONMENT:development",
    ])
  })

  it("leaves wrangler's default state alone without a persist directory", () => {
    expect(wranglerDevCmd({ port: 8787, inspectorPort: 9229, persistTo: undefined })).not.toContain(
      "--persist-to",
    )
    expect(migrationsCmd({ persistTo: undefined })).toEqual([
      "bunx",
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
    ])
  })

  it("applies the migrations to the same persist directory wrangler dev reads", () => {
    expect(migrationsCmd({ persistTo: "/tmp/x" }).slice(-2)).toEqual(["--persist-to", "/tmp/x"])
  })

  it("builds a loopback URL", () => {
    expect(localUrl(8801)).toBe("http://127.0.0.1:8801")
  })
})
