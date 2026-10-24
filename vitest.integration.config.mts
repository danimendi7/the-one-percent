import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Runs against the LOCAL Supabase stack only (see tests/integration/setup.ts).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.int.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
