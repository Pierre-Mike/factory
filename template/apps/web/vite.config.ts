import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// In development, /api goes to `wrangler dev`; in production both are the same Worker.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": "http://localhost:8787" },
  },
})
