/**
 * Typed Hono RPC client. `AppType` is a type-only import from the server, so every call is typed
 * end to end and nothing calls `fetch` directly. The API is same-origin (Workers serves both).
 */
import type { AppType } from "@app/server/types"
import { hc } from "hono/client"

export const api = hc<AppType>(window.location.origin).api
