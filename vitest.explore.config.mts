import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Exploratory checks against the REAL providers (M4g.1). Never part of `npm test` or CI: their
// answers change and they depend on the network. Run by hand with `npm run explore:metadata`.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.explore.ts"],
    environment: "node",
    testTimeout: 60_000,
    fileParallelism: false,
  },
})
