import type { NextConfig } from "next"

/**
 * Dev-only: allow the dev server to be opened from a phone on the same private
 * network (http://192.168.x.x:3000). Without this, Next.js blocks dev assets
 * for non-localhost origins, React never hydrates, and client-rendered screens
 * stay as empty skeletons. Private (RFC 1918) ranges only; ignored in production.
 */
const privateLanOrigins = [
  "192.168.*.*",
  "10.*.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  "*.local",
]

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: privateLanOrigins,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
