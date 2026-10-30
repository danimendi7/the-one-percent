"use client"

import { useState } from "react"
import { Gauge } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/shell/page-header"
import { BENCH_DB, removeBenchData, runSearchBench, type BenchSize, type SearchBenchResult, type Stats } from "./search-bench"

/**
 * Reference: Chromium 156 on the development PC (Ryzen 5 7535HS), `npm run bench:search`,
 * docs/reports/m4e-search.json. ×4 is DevTools CPU throttling, an approximation of a mid-range phone.
 */
const DESKTOP: Record<BenchSize, Record<"x1" | "x4", { typingP50: number; typingP95: number; coldMs: number; slicedMs: number; editMs: number; frequentP95: number }>> = {
  "5k": {
    x1: { typingP50: 3.9, typingP95: 5.6, coldMs: 184, slicedMs: 189, editMs: 5, frequentP95: 2.2 },
    x4: { typingP50: 42.1, typingP95: 67.1, coldMs: 1142, slicedMs: 1338, editMs: 24, frequentP95: 21.1 },
  },
  "10k": {
    x1: { typingP50: 4.3, typingP95: 8.1, coldMs: 331, slicedMs: 292, editMs: 8, frequentP95: 4.3 },
    x4: { typingP50: 46.7, typingP95: 87, coldMs: 2500, slicedMs: 3617, editMs: 65.6, frequentP95: 25 },
  },
}

const f = (n: number | null | undefined) => (n == null ? "N/D" : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
const ok = (p95: number) => (p95 < 100 ? "✓" : "✗")

function Row({ label, s, hits }: { label: string; s: Stats; hits?: number }) {
  return (
    <tr className="border-t border-border/70">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        {label}
        {hits !== undefined && <span className="block text-xs text-text-tertiary">{hits} {hits === 1 ? "nota" : "notas"}</span>}
      </th>
      <td className="num py-2 pr-3 text-right">{f(s.median)}</td>
      <td className="num py-2 pr-3 text-right">{f(s.p95)}</td>
      <td className="num py-2 text-right">{f(s.max)}</td>
    </tr>
  )
}

/**
 * `/dev/knowledge` (development only, M4e): measures Cerebro's search on THIS device with a
 * SYNTHETIC library (generated text, no real data). Open it on the phone through the development
 * server on the local network. Never touches the demo, the account, or any other database.
 */
export function SearchDiagnostics() {
  const [running, setRunning] = useState<BenchSize | null>(null)
  const [results, setResults] = useState<SearchBenchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cleaned, setCleaned] = useState<string | null>(null)

  async function run(size: BenchSize) {
    setRunning(size)
    setError(null)
    // Let the «Midiendo…» state paint before the CPU work starts.
    await new Promise((r) => setTimeout(r, 50))
    try {
      const r = await runSearchBench(size)
      setResults((xs) => [...xs, r])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(null)
    }
  }

  const json = JSON.stringify({ userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "", cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : null, results }, null, 2)

  return (
    <>
      <PageHeader title="Diagnóstico de búsqueda" description="Solo en desarrollo. Mide la búsqueda de Cerebro en este dispositivo con una biblioteca sintética." />
      <section className="panel mb-5 space-y-2 rounded-2xl p-4 text-sm text-text-secondary">
        <p>
          Los datos son <strong className="text-foreground">ficticios</strong> (texto generado, sin títulos ni personas reales) y no se mezclan con la demo ni con tu cuenta. La copia de prueba se guarda en una base propia, <code className="text-xs">{BENCH_DB}</code>, que se borra al terminar; no se abre ni se borra ninguna otra. Nada sale del dispositivo.
        </p>
        <p>Objetivo: búsqueda por debajo de 100 ms (p95) con 5.000 notas. Cada medición tarda unos segundos; la pantalla puede no responder mientras mide.</p>
      </section>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button onClick={() => run("5k")} disabled={!!running} data-testid="bench-5k">
          <Gauge aria-hidden /> {running === "5k" ? "Midiendo…" : "Medir con 5.000 notas"}
        </Button>
        <Button variant="outline" onClick={() => run("10k")} disabled={!!running} data-testid="bench-10k">
          {running === "10k" ? "Midiendo…" : "Medir con 10.000 notas"}
        </Button>
        <Button variant="ghost" onClick={async () => setCleaned((await removeBenchData()) ? "Base sintética borrada (o no existía)." : "No se pudo borrar la base sintética.")} disabled={!!running}>
          Borrar datos sintéticos
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mb-4 text-sm text-text-tertiary">
        {running ? `Midiendo con ${running === "5k" ? "5.000" : "10.000"} notas…` : (cleaned ?? (results.length ? `${results.length} medición(es) hechas.` : "Aún no hay mediciones."))}
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {error}
        </p>
      )}
      <div className="space-y-6">
        {results.map((r, i) => (
          <section key={i} className="panel space-y-3 rounded-2xl p-4" data-testid="bench-result">
            <h2 className="font-semibold">
              {r.notes.toLocaleString("es-ES")} notas · {r.items} contenidos
            </h2>
            <ul className="num space-y-1 text-sm">
              <li>
                Tecleo (búsqueda + resaltado de 60): p50 {f(r.typing.median)} ms · p95 <strong>{f(r.typing.p95)} ms</strong> {ok(r.typing.p95)}
              </li>
              <li>
                Índice en frío: {f(r.index.coldMs)} ms · por tramos: {f(r.sliced.totalMs)} ms, tramo más largo {f(r.sliced.longestSliceMs)} ms
              </li>
              <li>
                Actualización incremental: editar {f(r.incremental.editNoteMs)} ms · mover {f(r.incremental.moveNoteMs)} ms · renombrar un contenido con {r.incremental.renamedNotes} notas {f(r.incremental.renameContentMs)} ms
              </li>
              <li>
                Memoria aproximada: estado {f(r.memoryMB.state)} MB · índice {f(r.memoryMB.index)} MB
              </li>
              {r.storage && (
                <li>
                  Copia sintética: escribir {f(r.storage.writeMs)} ms · leer {f(r.storage.readMs)} ms · borrada: {r.storage.deleted ? "sí" : "no"}
                </li>
              )}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="bench-compare">
                <caption className="mb-1 text-left text-xs text-text-tertiary">Este dispositivo frente a Chromium de escritorio (×1 y CPU ×4), en ms</caption>
                <thead>
                  <tr className="text-xs text-text-tertiary">
                    <th scope="col" className="pb-1 text-left font-normal">
                      Medida
                    </th>
                    <th scope="col" className="pb-1 text-right font-normal">
                      Aquí
                    </th>
                    <th scope="col" className="pb-1 pr-3 text-right font-normal">
                      PC ×1
                    </th>
                    <th scope="col" className="pb-1 text-right font-normal">
                      PC ×4
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Tecleo p50", r.typing.median, "typingP50"],
                      ["Tecleo p95", r.typing.p95, "typingP95"],
                      ["Palabra frecuente p95", r.queries["palabra frecuente (atención)"]?.p95, "frequentP95"],
                      ["Índice de una vez", r.index.coldMs, "coldMs"],
                      ["Índice por tramos", r.sliced.totalMs, "slicedMs"],
                      ["Editar una nota (incremental)", r.incremental.editNoteMs, "editMs"],
                    ] as const
                  ).map(([label, here, key]) => (
                    <tr key={key} className="border-t border-border/70">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        {label}
                      </th>
                      <td className="num py-2 pr-3 text-right font-medium">{f(here)}</td>
                      <td className="num py-2 pr-3 text-right text-text-secondary">{f(DESKTOP[r.size].x1[key])}</td>
                      <td className="num py-2 text-right text-text-secondary">{f(DESKTOP[r.size].x4[key])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Tiempos en milisegundos</caption>
                <thead>
                  <tr className="text-xs text-text-tertiary">
                    <th scope="col" className="pb-1 text-left font-normal">
                      Consulta (ms)
                    </th>
                    <th scope="col" className="pb-1 text-right font-normal">
                      p50
                    </th>
                    <th scope="col" className="pb-1 text-right font-normal">
                      p95
                    </th>
                    <th scope="col" className="pb-1 text-right font-normal">
                      Máx.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(r.queries).map(([k, v]) => (
                    <Row key={k} label={k} s={v} hits={v.hits} />
                  ))}
                  {Object.entries(r.combined).map(([k, v]) => (
                    <Row key={k} label={`Filtros: ${k}`} s={v} hits={v.hits} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {results.length > 0 && (
        <Button variant="outline" className="mt-5" onClick={() => void navigator.clipboard?.writeText(json)}>
          Copiar resultados (JSON)
        </Button>
      )}
    </>
  )
}
