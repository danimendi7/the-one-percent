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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const onVercel = !!process.env.VERCEL

// Fail the build instead of deploying an insecure or accidentally demo-only production.
if (onVercel) {
  if (!supabaseUrl || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    if (process.env.VERCEL_ENV === "production") throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
  } else if (!supabaseUrl.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use https:// on Vercel")
  }
}

/** Origins the browser may talk to: this app and the Supabase project (REST, Auth, Realtime). */
function connectSources(): string {
  const sources = ["'self'"]
  if (supabaseUrl) {
    const u = new URL(supabaseUrl)
    sources.push(u.origin, `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`)
    // Local stack reached from a phone on the LAN (see resolveSupabaseUrl).
    if (["127.0.0.1", "localhost"].includes(u.hostname)) sources.push(`http://*:${u.port}`, `ws://*:${u.port}`)
  }
  if (process.env.NODE_ENV !== "production") sources.push("ws:", "wss:")
  return sources.join(" ")
}

const csp = [
  "default-src 'self'",
  // Next.js App Router hydration uses inline scripts; no third-party script origins are allowed.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSources()}`,
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ")

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(onVercel ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
]

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: privateLanOrigins,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }]
  },
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
