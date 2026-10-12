import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app is served by Cloudflare Pages, which also runs the /api/* functions.
// Use `npm run dev` (build + `wrangler pages dev`) to exercise the AI endpoint
// locally, or `npm run dev:web` for frontend-only iteration.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
