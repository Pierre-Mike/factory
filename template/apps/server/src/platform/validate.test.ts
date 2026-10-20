import { describe, expect, it } from "bun:test"
import { decodeApiErrorBody } from "@app/shared"
import { Schema } from "effect"
import { Hono } from "hono"
import { testClient } from "hono/testing"
import { onUnexpectedError } from "./http"
import { jsonBody } from "./validate"

const Note = Schema.Struct({ text: Schema.String })

const app = new Hono()
  .onError(onUnexpectedError)
  .post("/notes/:id", jsonBody(Note), (c) =>
    c.json({ id: c.req.param("id"), text: c.req.valid("json").text }),
  )

// The typed client the web app uses (`hc<AppType>`), wired straight to the app.
const client = testClient(app)

const post = (body: string) =>
  app.request("/notes/n1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  })

describe("jsonBody", () => {
  it("passes a body that matches the Schema to the handler, typed for hc", async () => {
    const res = await client.notes[":id"].$post({ param: { id: "n1" }, json: { text: "hi" } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: "n1", text: "hi" })
  })

  it("types the body from the Schema", async () => {
    // @ts-expect-error `text` must be a string: hc reads the body type from the Schema.
    const res = await client.notes[":id"].$post({ param: { id: "n1" }, json: { text: 1 } })
    expect(res.status).toBe(400)
  })

  it("answers a body that does not match with the 400 InvalidBody envelope", async () => {
    const res = await post(JSON.stringify({ text: 1 }))
    expect(res.status).toBe(400)
    const { error } = decodeApiErrorBody(await res.json())
    expect(error._tag).toBe("InvalidBody")
    expect(typeof error.message).toBe("string")
  })

  it("answers a request without a JSON content type with InvalidBody", async () => {
    const res = await app.request("/notes/n1", { method: "POST", body: '{"text":"hi"}' })
    expect(res.status).toBe(400)
    expect(decodeApiErrorBody(await res.json()).error._tag).toBe("InvalidBody")
  })

  it("answers malformed JSON with the 400 BadRequest envelope", async () => {
    const res = await post("{bad json")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: { _tag: "BadRequest" } })
  })
})
