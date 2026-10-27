#!/usr/bin/env node
/**
 * Guarded Auth configuration of THE ONE PERCENT's cloud project (Management API).
 *
 *   npm run cloud:auth                                   show current Auth settings (read-only)
 *   npm run cloud:auth -- --site-url https://<app>       show the planned diff (read-only)
 *   npm run cloud:auth -- --site-url https://<app> [--preview-pattern "https://the-one-percent-*-<scope>.vercel.app/**"]
 *                         [--smtp resend] [--disable-signup] --apply --confirm <ref>     apply
 *
 * Uses SUPABASE_ACCESS_TOKEN (and SMTP_PASS with --smtp) from the environment or the git-ignored .env.cloud.local.
 * Free projects cannot change email templates on Supabase's built-in mailer: without a custom
 * SMTP (current or --smtp) the templates are left out of the plan and a warning is shown.
 * Verifies the target with the same guard as npm run cloud before reading or writing.
 */
import { readFileSync } from "node:fs"
import { request } from "node:https"
import { evaluateCloudTarget } from "./lib/cloud-guard.mjs"
import { loadLocalSecrets } from "./lib/local-secrets.mjs"
import { supabaseCli } from "./lib/supabase-cli.mjs"

const cfg = JSON.parse(readFileSync("supabase/cloud-project.json", "utf8"))
const argv = process.argv.slice(2)
const opt = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const flag = (name) => argv.includes(name)

function fail(msg) {
  console.error(`\n✖ ${msg}\n`)
  process.exit(1)
}

loadLocalSecrets(["SUPABASE_ACCESS_TOKEN", "SMTP_PASS"])
const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) fail("Falta SUPABASE_ACCESS_TOKEN (variable de entorno o .env.cloud.local).")

// 1. Verify the target exactly like scripts/cloud.mjs.
const list = supabaseCli(["projects", "list", "-o", "json"], { encoding: "utf8", env: process.env })
if (list.status !== 0) fail(`No se pudo listar proyectos: ${list.stderr}`)
const guard = evaluateCloudTarget(JSON.parse(list.stdout.slice(list.stdout.search(/[[{]/))), cfg)
if (!guard.ok) fail(guard.problems.join("\n  "))
const ref = guard.target.ref
console.log(`✔ Destino verificado: ${guard.target.name} · ${ref} · ${guard.target.region}`)

const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }

/** Minimal JSON client on node:https (fetch leaves handles that trip a libuv assertion on Windows). */
function call(method, body) {
  return new Promise((resolve, reject) => {
    const req = request(api, { method, headers, agent: false }, (res) => {
      let data = ""
      res.on("data", (c) => (data += c))
      res.on("end", () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: data }))
    })
    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

const res = await call("GET")
if (!res.ok) fail(`GET config/auth → HTTP ${res.status}`)
const current = JSON.parse(res.text)

const KEYS = [
  "site_url",
  "uri_allow_list",
  "disable_signup",
  "external_email_enabled",
  "mailer_otp_length",
  "mailer_otp_exp",
  "mailer_subjects_magic_link",
  "mailer_templates_magic_link_content",
  "mailer_subjects_confirmation",
  "mailer_templates_confirmation_content",
  "mailer_autoconfirm",
  "smtp_host",
  "smtp_admin_email",
  "rate_limit_email_sent",
  "jwt_exp",
  "refresh_token_rotation_enabled",
]
const show = (v) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ") : JSON.stringify(v)
  return t.length > 80 ? `${t.slice(0, 77)}…` : t
}

const siteUrl = opt("--site-url")
if (!siteUrl) {
  console.log("\nConfiguración actual de Auth (solo lectura):")
  for (const k of KEYS) console.log(`  ${k.padEnd(38)} ${show(current[k])}`)
} else {
  await plan(siteUrl)
}

async function plan(siteUrl) {

if (!/^https:\/\/[a-z0-9.-]+$/i.test(siteUrl)) fail("--site-url debe ser https://dominio, sin barra final.")
const preview = opt("--preview-pattern")
const SMTP_PRESETS = {
  // Resend without an own domain only delivers to the account owner's address, which is all this app needs.
  resend: { smtp_host: "smtp.resend.com", smtp_port: "465", smtp_user: "resend", smtp_admin_email: "onboarding@resend.dev" },
}
const smtpName = opt("--smtp")
if (smtpName && !SMTP_PRESETS[smtpName]) fail(`--smtp admite: ${Object.keys(SMTP_PRESETS).join(", ")}`)
if (smtpName && !process.env.SMTP_PASS) fail("Falta SMTP_PASS (clave del proveedor) en .env.cloud.local.")
const smtp = smtpName
  ? { ...SMTP_PRESETS[smtpName], smtp_pass: process.env.SMTP_PASS, smtp_sender_name: "THE ONE PERCENT", rate_limit_email_sent: 30 }
  : {}
const canEditTemplates = Boolean(smtpName || current.smtp_host)
const templates = {
  mailer_subjects_magic_link: "Tu enlace de acceso a THE ONE PERCENT",
  mailer_templates_magic_link_content: readFileSync("supabase/templates/magic-link.html", "utf8"),
  mailer_subjects_confirmation: "Confirma tu acceso a THE ONE PERCENT",
  mailer_templates_confirmation_content: readFileSync("supabase/templates/confirm-signup.html", "utf8"),
}
const desired = {
  site_url: siteUrl,
  uri_allow_list: [siteUrl, `${siteUrl}/**`, ...(preview ? [preview] : []), "http://localhost:3000", "http://localhost:3000/**"].join(","),
  external_email_enabled: true,
  mailer_otp_length: 6,
  mailer_otp_exp: 3600,
  refresh_token_rotation_enabled: true,
  ...smtp,
  ...(canEditTemplates ? templates : {}),
  ...(flag("--disable-signup") ? { disable_signup: true } : {}),
}

const changes = Object.entries(desired).filter(([k, v]) => JSON.stringify(current[k]) !== JSON.stringify(v))
console.log("\nCambios planificados:")
if (!changes.length) console.log("  (ninguno: ya está configurado)")
for (const [k, v] of changes) console.log(`  ${k.padEnd(38)} ${k === "smtp_pass" ? "(oculto)" : `${show(current[k])}  →  ${show(v)}`}`)
if (!canEditTemplates)
  console.log("\n⚠ Sin SMTP propio: las plantillas en español (enlace + código) quedan fuera; el plan Free no permite cambiarlas con el correo integrado. Añade --smtp resend.")

if (!flag("--apply")) {
  console.log(`\nModo lectura. Para aplicar: añade --apply --confirm ${ref}`)
  process.exit(0)
}
if (opt("--confirm") !== ref) fail(`Para aplicar repite el ref exacto: --confirm ${ref}`)
if (!changes.length) process.exit(0)

  const patch = await call("PATCH", Object.fromEntries(changes))
  if (!patch.ok) return fail(`PATCH config/auth → HTTP ${patch.status}: ${patch.text.slice(0, 300)}`)
  console.log("✔ Configuración de Auth aplicada.")
}
