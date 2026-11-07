import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Libraries go into their own files: they change rarely, so the browser keeps them cached
// across new builds of the app.
const vendor: Record<string, RegExp> = {
  react: /node_modules\/(react|react-dom|react-router|scheduler)\//,
  motion: /node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//,
  vantage: /node_modules\/@vantage-ui\//,
  ui: /node_modules\/(cmdk|lucide-react|@tanstack|@radix-ui|idb-keyval)\//,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => Object.keys(vendor).find((k) => vendor[k]!.test(id)),
      },
    },
  },
  test: { environment: "jsdom", setupFiles: ["test/setup.ts"] },
});
