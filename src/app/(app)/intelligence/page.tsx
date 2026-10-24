import type { Metadata } from "next"
import { Cpu, KeyRound, Lock, ShieldCheck } from "lucide-react"
import { DemoBadge } from "@/components/common/demo-note"
import { PageHeader } from "@/components/shell/page-header"

export const metadata: Metadata = { title: "Inteligencia" }

const PRINCIPLES = [
  { icon: Lock, title: "Opcional y apagada por defecto", body: "La app funciona completa sin ningún proveedor de IA ni clave." },
  { icon: KeyRound, title: "Claves solo en el servidor", body: "Nunca en el navegador. Con cuotas, caché y límites de coste." },
  { icon: ShieldCheck, title: "Fuentes antes que afirmaciones", body: "Lo no verificado se etiqueta como tal. Sin estudios ni enlaces inventados." },
  { icon: Cpu, title: "Tus datos privados no salen", body: "Check-ins, diario y notas no se envían a modelos sin permiso explícito." },
]

export default function IntelligencePage() {
  return (
    <>
      <PageHeader
        title="Inteligencia"
        meta={<DemoBadge>Sin proveedor configurado</DemoBadge>}
        description="Explicaciones de tus datos y sugerencias de temas, siempre opcionales. Llega en la fase M6."
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {PRINCIPLES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="panel rounded-2xl p-5">
            <Icon className="size-5 text-signal" strokeWidth={1.75} aria-hidden />
            <h2 className="mt-4 font-semibold">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{body}</p>
          </li>
        ))}
      </ul>
    </>
  )
}
