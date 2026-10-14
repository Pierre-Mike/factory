/**
 * Health route. The loader prefetches via `ensureQueryData` (so data is in the
 * cache before render) and the component reads with `useSuspenseQuery` against
 * the SAME `healthQuery` — no loading flash, no duplicate fetch, no `queryKey`
 * drift. This is the canonical Router(loader)+Query(cache) split: the router
 * drives navigation/prefetch, the query cache owns the data.
 */
import { useSuspenseQuery } from "@tanstack/react-query"
import { createRoute } from "@tanstack/react-router"
import { rootRoute } from "../../root-route"
import { healthQuery } from "./health.queries"

function HealthComponent() {
  const { data } = useSuspenseQuery(healthQuery)
  return (
    <main>
      <h1>Service health</h1>
      <p data-testid="health-status">{data.ok ? "ok" : "down"}</p>
      <dl>
        <dt>version</dt>
        <dd data-testid="health-version">{data.version}</dd>
        <dt>uptimeMs</dt>
        <dd data-testid="health-uptime">{data.uptimeMs}</dd>
      </dl>
    </main>
  )
}

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ({ context }) => context.queryClient.ensureQueryData(healthQuery),
  component: HealthComponent,
})
