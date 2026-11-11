"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { BellOff, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowser } from "@/lib/supabase/browser"
import { cn } from "@/lib/utils"
import { pushAvailability, type PushAvailability, type PushDevice, type PushEnvironment } from "../domain/push"
import { disable, enable, listDevices, PushError, readEnvironment, removeDevice, sendTest, type TestResult } from "./push-client"

/**
 * E8 · Push on this device. The permission prompt opens only from «Activar» (PRD §5.3), each device
 * turns itself on and off, and any device can remove another from the list. Until the scheduled
 * sender exists (E9, pending authorisation) the only push sent is the test: the reminders keep
 * arriving in the in-app inbox, and the text says so.
 */

const UNAVAILABLE: Record<Exclude<PushAvailability, "available">, string> = {
  demo: "En la demo no se registra ningún dispositivo. Los avisos aparecen en la bandeja de la app.",
  unconfigured: "Este servidor aún no tiene configurado el envío push (pendiente de autorización). Los avisos aparecen en la bandeja de la app.",
  install:
    "En iPhone y iPad, las notificaciones push requieren añadir la app a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y activarlas desde allí. Mientras, los avisos aparecen en la bandeja de la app.",
  unsupported: "Este navegador no admite notificaciones push. Los avisos aparecen en la bandeja de la app.",
}

const ERRORS: Record<PushError["code"], string> = {
  denied: "Las notificaciones están bloqueadas para esta web. Puedes permitirlas en los ajustes del navegador.",
  dismissed: "No se ha concedido el permiso. Puedes intentarlo de nuevo cuando quieras.",
  no_worker: "No se pudo preparar el servicio en segundo plano de la app. Recarga la página e inténtalo de nuevo.",
  subscribe_failed: "El navegador no pudo crear la suscripción. Inténtalo de nuevo más tarde.",
  server: "No se pudo guardar en el servidor. Inténtalo de nuevo.",
  offline: "Sin conexión. Inténtalo cuando vuelvas a tener red.",
  device_limit: "Has llegado al máximo de 20 dispositivos. Quita alguno de la lista.",
}

const TEST: Record<TestResult, { ok: boolean; text: string }> = {
  accepted: { ok: true, text: "El servicio push ha aceptado la prueba. Debería aparecer en unos segundos; si no, revisa los permisos de notificaciones del sistema." },
  gone: { ok: false, text: "El servicio push dice que esta suscripción ya no existe. Vuelve a activarlas." },
  not_registered: { ok: false, text: "Este dispositivo no está registrado. Vuelve a activarlas." },
  not_configured: { ok: false, text: "El servidor aún no tiene configurado el envío (pendiente de autorización)." },
  rate_limited: { ok: false, text: "Demasiadas pruebas seguidas. Espera un minuto." },
  failed: { ok: false, text: "No se pudo enviar la prueba. Inténtalo de nuevo." },
}

const noop = () => () => {}
let envCache: { demo: boolean; env: PushEnvironment } | null = null
function envSnapshot(demo: boolean): PushEnvironment {
  if (!envCache || envCache.demo !== demo) envCache = { demo, env: readEnvironment(demo) }
  return envCache.env
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb)
  window.addEventListener("offline", cb)
  return () => {
    window.removeEventListener("online", cb)
    window.removeEventListener("offline", cb)
  }
}
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" })

export function PushSection({ demo }: { demo: boolean }) {
  const env = useSyncExternalStore(noop, () => envSnapshot(demo), () => null)
  const availability = env ? pushAvailability(env) : null
  return (
    <section className="panel rounded-2xl p-5" aria-labelledby="push-title" data-testid="push-section">
      <h2 id="push-title" className="font-semibold">
        Notificaciones push en este dispositivo
      </h2>
      {availability === null ? (
        <p className="mt-1 text-sm text-text-secondary">Comprobando…</p>
      ) : availability === "available" ? (
        <PushControls />
      ) : (
        <div className="mt-3 flex items-start gap-3">
          <BellOff className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden />
          <p className="text-sm leading-relaxed text-text-secondary" data-testid="push-unavailable" data-reason={availability}>
            {UNAVAILABLE[availability]}
          </p>
        </div>
      )}
    </section>
  )
}

type Load = { status: "loading" } | { status: "ready"; devices: PushDevice[] } | { status: "error"; text: string }

function PushControls() {
  const sb = getSupabaseBrowser()
  const online = useOnline()
  const [load, setLoad] = useState<Load>({ status: "loading" })
  const [permission, setPermission] = useState<NotificationPermission>(() => Notification.permission)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = useCallback(
    () =>
      sb
        ? listDevices(sb).then(
            (devices) => setLoad({ status: "ready", devices }),
            (e: unknown) => setLoad({ status: "error", text: e instanceof PushError ? ERRORS[e.code] : ERRORS.server })
          )
        : Promise.resolve(),
    [sb]
  )

  // Loads the list on opening and again when the connection comes back.
  useEffect(() => {
    if (!online || !sb) return
    let live = true
    listDevices(sb).then(
      (devices) => live && setLoad({ status: "ready", devices }),
      (e: unknown) => live && setLoad({ status: "error", text: e instanceof PushError ? ERRORS[e.code] : ERRORS.server })
    )
    return () => {
      live = false
    }
  }, [online, sb])

  if (!sb) return null
  const devices = load.status === "ready" ? load.devices : []
  const on = devices.some((d) => d.current)

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setMessage(null)
    try {
      await fn()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof PushError ? ERRORS[e.code] : ERRORS.server })
    } finally {
      setPermission(Notification.permission)
      await refresh()
      setBusy(null)
    }
  }

  const turnOn = () =>
    run("enable", async () => {
      await enable(sb)
      setMessage({ ok: true, text: "Activadas en este dispositivo." })
    })
  const turnOff = () =>
    run("disable", async () => {
      await disable(sb)
      setMessage({ ok: true, text: "Desactivadas en este dispositivo. Los demás dispositivos no cambian." })
    })
  const test = () =>
    run("test", async () => {
      setMessage(TEST[await sendTest()])
    })
  const remove = (d: PushDevice) =>
    run(`remove:${d.id}`, async () => {
      await removeDevice(sb, d.id)
      setMessage({ ok: true, text: `${d.label} ya no recibirá notificaciones push.` })
    })

  const status = !online
    ? "sin conexión"
    : load.status === "loading"
      ? "comprobando…"
      : load.status === "error"
        ? "no se pudo comprobar"
        : on
        ? "activadas"
        : permission === "denied"
          ? "bloqueadas en el navegador"
          : "desactivadas"

  return (
    <div className="mt-1">
      <div className="flex items-start gap-3">
        {on ? <BellRing className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden /> : <BellOff className="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden />}
        <p className="text-sm leading-relaxed text-text-secondary">
          Estado: <strong className="font-medium text-foreground" data-testid="push-status">{status}</strong>.{" "}
          {on
            ? "Los avisos aparecen siempre en la bandeja de la app y, cuando el envío programado está activado en el servidor, también llegan aquí como notificación."
            : "El permiso solo se pide al pulsar «Activar». Cada dispositivo se activa y se desactiva por separado."}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {on ? (
          <>
            <Button onClick={test} disabled={!online || busy !== null}>
              {busy === "test" ? "Enviando…" : "Enviar prueba"}
            </Button>
            <Button variant="outline" onClick={turnOff} disabled={!online || busy !== null}>
              {busy === "disable" ? "Desactivando…" : "Desactivar en este dispositivo"}
            </Button>
          </>
        ) : (
          permission !== "denied" && (
            <Button onClick={turnOn} disabled={!online || load.status === "loading" || busy !== null}>
              {busy === "enable" ? "Activando…" : "Activar en este dispositivo"}
            </Button>
          )
        )}
      </div>

      <p role="status" aria-live="polite" className={cn("mt-2 min-h-5 text-sm", message?.ok ? "text-signal" : "text-warning")} data-testid="push-message">
        {permission === "denied" && !on && !message ? ERRORS.denied : (message?.text ?? (load.status === "error" ? load.text : ""))}
      </p>

      {load.status === "ready" && devices.length > 0 && (
        <div className="mt-4 border-t border-border/70 pt-4">
          <h3 className="text-sm font-medium">Dispositivos con push ({devices.length})</h3>
          <ul className="mt-2 divide-y divide-border/70" data-testid="push-devices">
            {devices.map((d) => (
              <li key={d.id} className="flex min-h-12 items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {d.label}
                    {d.current && <span className="ml-2 text-xs text-signal">Este dispositivo</span>}
                  </p>
                  <p className="text-xs text-text-tertiary">Desde el {dateFmt.format(new Date(d.createdAt))}</p>
                </div>
                {!d.current && (
                  <Button variant="ghost" size="touch-sm" onClick={() => remove(d)} disabled={!online || busy !== null} aria-label={`Quitar ${d.label}`}>
                    Quitar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
