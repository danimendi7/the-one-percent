import { createHash } from "node:crypto"

const sha = (v) => createHash("sha256").update(String(v ?? "")).digest("hex")
const isForbiddenRef = (cfg, ref) => cfg.forbiddenRefHashes.includes(sha(ref))
const isForbiddenOrg = (cfg, org) => cfg.forbiddenOrganizationHashes.includes(sha(org))

/**
 * Pure decision logic for every cloud command. Returns { ok, target?, problems[] }.
 * `projects` is the JSON from `supabase projects list -o json` for the token in use.
 */
/**
 * @param {unknown} projects
 * @param {{ name: string, ref: string | null, organizationId: string | null, region: string, forbiddenRefHashes: string[], forbiddenOrganizationHashes: string[] }} cfg
 * @param {string | null} [linkedRef] null = do not check the local link
 */
export function evaluateCloudTarget(projects, cfg, linkedRef = null) {
  const problems = []
  const list = Array.isArray(projects) ? projects : (projects?.projects ?? [])
  const refOf = (p) => p.ref ?? p.id
  const orgOf = (p) => p.organization_id ?? p.organization_slug

  // The token must belong to THE ONE PERCENT's account, never to the account that holds forbidden projects.
  const forbiddenVisible = list.filter(
    (p) => isForbiddenRef(cfg, refOf(p)) || isForbiddenOrg(cfg, orgOf(p))
  )
  if (forbiddenVisible.length > 0) {
    problems.push(
      `El token tiene acceso a un proyecto u organización prohibidos (${forbiddenVisible.length}). Usa el token de la cuenta de THE ONE PERCENT.`
    )
  }

  if (!cfg.ref) {
    const candidates = list.filter((p) => p.name === cfg.name).map((p) => ({ ref: refOf(p), org: orgOf(p), region: p.region }))
    problems.push(
      candidates.length
        ? `Falta "ref" en supabase/cloud-project.json. Candidatos con nombre ${cfg.name}: ${JSON.stringify(candidates)}`
        : `Falta "ref" en supabase/cloud-project.json y no hay ningún proyecto llamado ${cfg.name} en esta cuenta.`
    )
    return { ok: false, problems }
  }

  if (isForbiddenRef(cfg, cfg.ref)) problems.push(`El ref configurado (${cfg.ref}) está en la lista prohibida.`)
  const target = list.find((p) => refOf(p) === cfg.ref)
  if (!target) {
    problems.push(`El proyecto ${cfg.ref} no existe o no es accesible con este token.`)
  } else {
    if (target.name !== cfg.name) problems.push(`Nombre inesperado: "${target.name}" (se esperaba "${cfg.name}").`)
    if (cfg.organizationId && orgOf(target) !== cfg.organizationId)
      problems.push(`Organización inesperada: ${orgOf(target)} (se esperaba ${cfg.organizationId}).`)
    if (isForbiddenOrg(cfg, orgOf(target))) problems.push(`La organización ${orgOf(target)} está prohibida.`)
    if (cfg.region && target.region !== cfg.region) problems.push(`Región inesperada: ${target.region} (se esperaba ${cfg.region}).`)
  }
  if (linkedRef !== null && linkedRef !== cfg.ref) {
    problems.push(`El repo está enlazado a ${linkedRef || "(nada)"}, no a ${cfg.ref}. Ejecuta "npm run cloud -- link".`)
  }
  return {
    ok: problems.length === 0,
    target: target && { ref: refOf(target), name: target.name, organization: orgOf(target), region: target.region, status: target.status },
    problems,
  }
}

/** A database URL must point at the expected project (direct host or pooler user) and never a forbidden one. */
/**
 * @param {string} url
 * @param {{ ref: string | null, forbiddenRefHashes: string[] }} cfg
 */
export function evaluateDbUrl(url, cfg) {
  const problems = []
  if (!url) return { ok: false, problems: ["Falta SUPABASE_DB_URL."] }
  // Any 20-char project ref inside the URL is checked against the forbidden hashes.
  for (const ref of url.match(/[a-z]{20}/g) ?? []) if (isForbiddenRef(cfg, ref)) problems.push("La URL apunta a un proyecto prohibido.")
  if (!cfg.ref) problems.push('Falta "ref" en supabase/cloud-project.json.')
  else if (!url.includes(cfg.ref)) problems.push(`La URL no contiene el ref esperado (${cfg.ref}).`)
  return { ok: problems.length === 0, problems }
}
