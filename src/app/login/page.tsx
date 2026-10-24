import type { Metadata } from "next"
import { Suspense } from "react"
import { BrandMark } from "@/components/shell/brand-mark"
import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Acceder" }

export default function LoginPage() {
  return (
    <main className="canvas-glow relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-12" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">THE ONE PERCENT</h1>
          <p className="mt-1.5 text-sm text-text-secondary">Tu sistema personal de rendimiento.</p>
        </div>
        <Suspense fallback={<div className="panel h-64 animate-pulse rounded-2xl" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  )
}
