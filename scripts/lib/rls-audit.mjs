/**
 * RLS audit of a THE ONE PERCENT database (G2, Orden 2 §3). Used by `npm run db:fresh` after applying
 * every migration to a new, empty project, and by tests/integration/db-fresh.int.test.ts against the
 * local stack. Read-only: the behavioural check runs inside a savepoint that is always rolled back.
 *
 * What it refuses:
 * - a table in `public` without RLS;
 * - a table with RLS but no policy, unless it is one of the server-only tables (no grants at all);
 * - a server-only table that anon or authenticated can read or write;
 * - a policy for anon or for everyone (`public`), or one that does not depend on auth.uid();
 * - a view in `public` (views skip RLS unless security_invoker);
 * - a SECURITY DEFINER function in `public` without a fixed search_path;
 * - a migration file missing from the database's history;
 * - one person seeing another person's rows (habits, through apply_ops and pull_changes).
 */

/** Tables only the server touches (through SECURITY DEFINER functions or the service role): RLS, no policies, no grants. */
export const SERVER_ONLY_TABLES = ["push_subscriptions", "push_deliveries"]

/** Version prefixes of the migration files (`20261111090000_name.sql` → `20261111090000`). */
export function migrationVersions(files) {
  return files.filter((f) => /^\d{14}_.+\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort()
}

/** Files whose version is not in the database's history. */
export function missingMigrations(files, applied) {
  const have = new Set(applied.map(String))
  return migrationVersions(files).filter((v) => !have.has(v))
}

/** A database is a valid target for a fresh install only when it has no app table and no migration history. */
export function targetState({ publicTables, migrationRows }) {
  return publicTables === 0 && migrationRows === 0 ? "empty" : "not_empty"
}

async function rows(client, sql, params = []) {
  return (await client.query(sql, params)).rows
}

/** Structural checks (catalog only). */
export async function auditStructure(client, { migrationFiles } = {}) {
  const problems = []
  const tables = await rows(
    client,
    `select c.relname as name, c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by 1`
  )
  for (const t of tables) {
    if (!t.rls) problems.push(`la tabla public.${t.name} no tiene RLS`)
    else if (t.policies === 0 && !SERVER_ONLY_TABLES.includes(t.name)) problems.push(`la tabla public.${t.name} tiene RLS pero ninguna política`)
  }
  for (const name of SERVER_ONLY_TABLES) {
    if (!tables.some((t) => t.name === name)) continue
    for (const role of ["anon", "authenticated"]) {
      const [g] = await rows(client, `select has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE') as granted`, [role, `public.${name}`])
      if (g.granted) problems.push(`${role} tiene permisos sobre public.${name}, que solo debe tocar el servidor`)
    }
  }
  const policies = await rows(
    client,
    `select tablename, policyname, roles::text as roles, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
       from pg_policies where schemaname = 'public'`
  )
  for (const p of policies) {
    if (p.roles !== "{authenticated}") problems.push(`la política «${p.policyname}» de public.${p.tablename} no es solo para authenticated (${p.roles})`)
    if (!p.expr.includes("auth.uid()")) problems.push(`la política «${p.policyname}» de public.${p.tablename} no depende de auth.uid()`)
  }
  const views = await rows(
    client,
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm') and not coalesce(c.reloptions @> array['security_invoker=true'], false)`
  )
  for (const v of views) problems.push(`la vista public.${v.name} se salta RLS (falta security_invoker)`)
  const definers = await rows(
    client,
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)`
  )
  for (const f of definers) problems.push(`la función public.${f.name} es SECURITY DEFINER sin search_path fijo`)

  let applied = []
  const [history] = await rows(client, `select to_regclass('supabase_migrations.schema_migrations') is not null as present`)
  if (history.present) applied = (await rows(client, "select version from supabase_migrations.schema_migrations")).map((r) => r.version)
  if (migrationFiles) for (const v of missingMigrations(migrationFiles, applied)) problems.push(`falta la migración ${v} en el historial de la base`)

  return { problems, tables: tables.length, policies: policies.length, migrations: applied.length }
}

/**
 * Behavioural check: two people created inside a savepoint, a habit written by one through apply_ops,
 * then read by the other and by anon. Everything is rolled back, whatever happens.
 */
export async function auditIsolation(client) {
  const problems = []
  const a = crypto.randomUUID()
  const b = crypto.randomUUID()
  const habit = crypto.randomUUID()
  const email = (u) => `rls-audit-${u}@theonepercent.invalid`
  const as = async (uid, fn) => {
    await client.query("savepoint rls_as")
    try {
      await client.query("set local role authenticated")
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })])
      return await fn()
    } finally {
      await client.query("rollback to savepoint rls_as")
    }
  }
  await client.query("savepoint rls_audit")
  try {
    for (const u of [a, b]) {
      await client.query("insert into private.allowed_emails (email, note) values ($1, 'rls audit, rolled back')", [email(u)])
      await client.query("insert into auth.users (id, email, aud, role) values ($1, $2, 'authenticated', 'authenticated')", [u, email(u)])
    }
    // Person A writes a habit and, in the same savepoint, nobody else can see it.
    await client.query("savepoint rls_write")
    await client.query("set local role authenticated")
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: a, role: "authenticated" })])
    const op = {
      type: "habit.create",
      op_id: `rls-audit-${habit}`,
      habit: { id: habit, title: "Auditoría", icon: "check", dimension: "body", habit_type: "binary", unit: null, target_value: null, target_direction: null, start_date: "2026-01-01" },
      versions: [{ valid_from: "2026-01-01", rule: { kind: "daily" } }],
    }
    const [res] = await rows(client, "select public.apply_ops('rls-audit', $1::jsonb) as r", [JSON.stringify([op])])
    const status = res.r?.results?.[0]?.status
    if (status !== "applied") problems.push(`apply_ops no aplicó la escritura de prueba (${status ?? "sin resultado"})`)
    const [own] = await rows(client, "select count(*)::int as n from public.habits where id = $1", [habit])
    if (own.n !== 1) problems.push("la persona que escribe no ve su propio hábito")
    await client.query("reset role")

    const seenByB = await as(b, async () => (await rows(client, "select count(*)::int as n from public.habits where id = $1", [habit]))[0].n)
    if (seenByB !== 0) problems.push("otra persona ve el hábito por consulta directa")
    const pulledByB = await as(b, async () => (await rows(client, "select public.pull_changes(0) as p"))[0].p)
    if ((pulledByB?.habits ?? []).some((h) => h.id === habit)) problems.push("otra persona recibe el hábito en pull_changes")

    await client.query("savepoint rls_anon")
    try {
      await client.query("set local role anon")
      const [n] = await rows(client, "select count(*)::int as n from public.habits")
      if (n.n !== 0) problems.push("anon ve filas de public.habits")
    } catch (e) {
      // Permission denied is just as good: anon reads nothing.
      if (!/permission denied/.test(String(e?.message))) problems.push(`anon: error inesperado (${e?.message})`)
    } finally {
      await client.query("rollback to savepoint rls_anon")
    }
    await client.query("rollback to savepoint rls_write")
  } finally {
    await client.query("rollback to savepoint rls_audit")
  }
  return { problems }
}

/** Both checks inside one transaction that is rolled back. */
export async function auditDatabase(client, { migrationFiles } = {}) {
  await client.query("begin")
  try {
    const structure = await auditStructure(client, { migrationFiles })
    const isolation = await auditIsolation(client)
    return { ...structure, problems: [...structure.problems, ...isolation.problems] }
  } finally {
    await client.query("rollback")
  }
}
