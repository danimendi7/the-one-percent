"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EpisodePicker } from "../components/add-podcast-sheet"
import type { EpisodeResult } from "../metadata/types"

/**
 * M4g.4 · timings of the episode picker with 200 synthetic episodes, for a real phone on the local
 * network (`next dev`; production answers 404). No request is made and no account data is read:
 * the episodes are generated here. It times the first drawing of the list and each keystroke of a
 * filter (input to next paint, Event Timing API where the browser has it; Safari may not).
 */
function synthetic(n: number): EpisodeResult[] {
  const start = Date.parse("2026-10-28T23:30:00.000Z")
  return Array.from({ length: n }, (_, i) => ({
    provider: "itunes",
    id: String(1000000000000 + i),
    showId: "1",
    showTitle: "Programa sintético",
    title: `${n - i}. Episodio sintético con un título de longitud realista número ${n - i}`,
    description: `Descripción sintética del episodio ${n - i}. `.repeat(8).trim(),
    durationSeconds: 3600 + ((i * 97) % 3000),
    publishedAt: new Date(start - i * 3.5 * 86400_000).toISOString(),
    cover: null,
    sourceUrl: null,
    attribution: "Datos sintéticos",
  }))
}

const EPISODES = synthetic(200)
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0)
const nextPaint = () => new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))))

export function EpisodeDiagnostics() {
  const [mounted, setMounted] = useState(false)
  const [filter, setFilter] = useState("")
  const [lines, setLines] = useState<string[]>([])
  const typed = useRef<number[]>([])
  const log = (s: string) => setLines((l) => [...l, s])

  useEffect(() => {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("event")) return
    const o = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (/key|input/.test(e.name)) typed.current.push(Math.round(e.duration))
    })
    o.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit)
    return () => o.disconnect()
  }, [])

  async function measureMount() {
    setMounted(false)
    await nextPaint()
    const t = performance.now()
    setMounted(true)
    const done = await nextPaint()
    log(`Primer dibujo de la lista (200 episodios, ${30} visibles): ${Math.round(done - t)} ms`)
  }

  async function measureFilter() {
    if (!mounted) await measureMount()
    const word = "episodio sint"
    const times: number[] = []
    for (let i = 1; i <= word.length; i++) {
      const t = performance.now()
      setFilter(word.slice(0, i))
      times.push((await nextPaint()) - t)
    }
    setFilter("")
    log(`Filtrado tecla a tecla («${word}», ${word.length} pasos): mediana ${Math.round(median(times))} ms · máximo ${Math.round(Math.max(...times))} ms`)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Diagnóstico · selector de episodios</h1>
      <p className="text-sm text-text-secondary">Solo en desarrollo. 200 episodios generados aquí; ninguna petición, ningún dato de la cuenta.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={measureMount} data-testid="diag-mount">
          Medir el primer dibujo
        </Button>
        <Button variant="outline" onClick={measureFilter} data-testid="diag-filter">
          Medir el filtrado
        </Button>
        <Button variant="ghost" onClick={() => log(typed.current.length ? `Teclas escritas a mano ≥16 ms: ${typed.current.length} · máximo ${Math.max(...typed.current)} ms` : "Teclas escritas a mano: ninguna de 16 ms o más (o el navegador no mide eventos)")}>
          Ver mis teclas
        </Button>
      </div>
      <ul className="space-y-1 rounded-xl border border-border p-3 text-sm" data-testid="diag-results">
        {lines.length === 0 ? <li className="text-text-tertiary">Sin medidas todavía.</li> : lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Escribe aquí para medir tus teclas" aria-label="Filtro de prueba" />
      {mounted && <EpisodePicker episodes={EPISODES} filter={filter} heading="200 episodios sintéticos" timeZone="Europe/Madrid" onChoose={() => {}} />}
    </div>
  )
}
