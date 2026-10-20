import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In development, /api goes to `wrangler dev`; in production both are the same Worker.
// `axioms dev --port` sets WEB_PORT and API_URL, so parallel runs never share a port.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": process.env.API_URL ?? "http://127.0.0.1:8787" },
  },
})
