import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/shell/brand-mark"

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <BrandMark className="mx-auto size-10" />
        <h1 className="mt-6 text-2xl font-semibold">Página no encontrada</h1>
        <p className="mt-2 text-text-secondary">Esta ruta no existe en THE ONE PERCENT.</p>
        <Button asChild className="mt-6">
          <Link href="/">Volver al resumen</Link>
        </Button>
      </div>
    </main>
  )
}
