/**
 * The `health` query, defined ONCE. Both the route loader (prefetch) and the
 * component (read) reference this same `queryOptions`, so the key + fetcher
 * never drift. The fetcher calls the typed Hono RPC client — no raw fetch —
 * and decodes the body against the shared contract, so server/client drift
 * fails loudly at the boundary instead of silently in the UI.
 */

import { decodeHealthStatus } from "@app/shared"
import { queryOptions } from "@tanstack/react-query"
import { api } from "../../lib/api"

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: async () => {
    const res = await api.health.$get()
    if (!res.ok) throw new Error(`health request failed: ${res.status}`)
    return decodeHealthStatus(await res.json())
  },
})
