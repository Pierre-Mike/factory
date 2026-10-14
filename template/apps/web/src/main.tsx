/**
 * Web entry point. Wires the QueryClientProvider (cache) around the
 * RouterProvider (navigation). The same `queryClient` is handed to the router
 * context so loaders share the component cache.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createAppRouter } from "./router"

const queryClient = new QueryClient()
const router = createAppRouter({ queryClient })

const rootEl = document.getElementById("root")
if (!rootEl) throw new Error("missing #root element")

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
