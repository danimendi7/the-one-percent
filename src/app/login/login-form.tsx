"use client"

import { useId, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, FlaskConical, Mail, MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getSupabaseBrowser } from "@/lib/supabase/browser"
import { DEMO_COOKIE } from "@/lib/supabase/env"

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isLocalHost(host: string) {
  return host === "localhost" || host === "127.0.0.1" || /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(host)
}

export function LoginForm() {
  const id = useId()
  const params = useSearchParams()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [state, setState] = useState<State>(
    params.get("error") === "link"
      ? { kind: "error", message: "El enlace no es válido o ha caducado. Pide uno nuevo." }
      : { kind: "idle" }
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!EMAIL_RE.test(value)) {
      setState({ kind: "error", message: "Introduce un email válido." })
      return
    }
    const supabase = getSupabaseBrowser()
    if (!supabase) {
      setState({ kind: "error", message: "La cuenta no está configurada en este entorno. Puedes explorar la demo." })
      return
    }
    setState({ kind: "sending" })
    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    })
    // Private app: do not reveal whether an address is allowlisted. Only transport
    // problems and rate limits are shown as errors.
    if (error && (error.status === undefined || error.status === 429 || error.status === 0)) {
      setState({
        kind: "error",
        message: error.status === 429 ? "Demasiados intentos. Espera un minuto y vuelve a probar." : "No se pudo conectar. Revisa la conexión e inténtalo de nuevo.",
      })
      return
    }
    setState({ kind: "sent", email: value })
  }

  function exploreDemo() {
    document.cookie = `${DEMO_COOKIE}=demo; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`
    router.push("/")
  }

  if (state.kind === "sent") {
    const host = typeof window !== "undefined" ? window.location.hostname : ""
    return (
      <div className="panel rounded-2xl p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-signal/10">
          <MailCheck className="size-6 text-signal" aria-hidden />
        </div>
        <h2 className="mt-4 text-lg font-semibold" role="status">
          Revisa tu correo
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          Si <span className="text-foreground">{state.email}</span> tiene acceso, recibirás un enlace para entrar. Caduca en una hora y
          puedes abrirlo en cualquier dispositivo.
        </p>
        {isLocalHost(host) && (
          <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs leading-relaxed text-text-tertiary">
            Entorno local: los correos no salen del equipo. Ábrelo en{" "}
            <a className="text-text-secondary underline underline-offset-2" href={`http://${host}:55324`} target="_blank" rel="noreferrer">
              Mailpit ({host}:55324)
            </a>
            .
          </p>
        )}
        <CodeForm email={state.email} />
        <Button variant="ghost" className="mt-2" onClick={() => setState({ kind: "idle" })}>
          Usar otro email
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="panel space-y-4 rounded-2xl p-6" noValidate>
        <div className="space-y-2">
          <Label htmlFor={id}>Email</Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <Input
              id={id}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 pl-10 text-base"
              aria-invalid={state.kind === "error"}
              aria-describedby={state.kind === "error" ? `${id}-err` : `${id}-hint`}
            />
          </div>
          {state.kind === "error" ? (
            <p id={`${id}-err`} role="alert" className="text-sm text-error">
              {state.message}
            </p>
          ) : (
            <p id={`${id}-hint`} className="text-xs text-text-tertiary">
              Te enviaremos un enlace de acceso. Sin contraseñas.
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Enviando…" : "Enviar enlace de acceso"}
          {state.kind !== "sending" && <ArrowRight data-icon="inline-end" />}
        </Button>
      </form>

      <button
        type="button"
        onClick={exploreDemo}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm text-text-secondary transition-colors hover:bg-surface hover:text-foreground"
      >
        <FlaskConical className="size-4 text-warning" aria-hidden />
        Explorar la demo sin cuenta
      </button>
    </div>
  )
}

/**
 * Alternative to the link: the 6-digit code from the same email (6–8 digits accepted,
 * in case the project's OTP length differs). Works on
 * another device, on the local network and inside an installed iOS PWA
 * (where links open in Safari instead of the app).
 */
function CodeForm({ email }: { email: string }) {
  const id = useId()
  const [code, setCode] = useState("")
  const [status, setStatus] = useState<"idle" | "checking" | "error">("idle")

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    const supabase = getSupabaseBrowser()
    if (!supabase || code.length < 6) return
    setStatus("checking")
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" })
    if (error) {
      setStatus("error")
      return
    }
    document.cookie = `${DEMO_COOKIE}=; path=/; max-age=0`
    // Full navigation so the proxy sees the fresh session cookie.
    window.location.replace("/")
  }

  return (
    <form onSubmit={verify} className="mt-5 space-y-2 border-t border-border pt-5 text-left" noValidate>
      <Label htmlFor={id}>¿Tienes el código del correo?</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/D/g, "").slice(0, 8))}
          className="num h-12 flex-1 text-center text-lg tracking-[0.4em]"
          aria-invalid={status === "error"}
          aria-describedby={status === "error" ? `${id}-err` : undefined}
        />
        <Button type="submit" size="lg" disabled={code.length < 6 || status === "checking"}>
          {status === "checking" ? "…" : "Entrar"}
        </Button>
      </div>
      {status === "error" && (
        <p id={`${id}-err`} role="alert" className="text-sm text-error">
          Código incorrecto o caducado.
        </p>
      )}
    </form>
  )
}
