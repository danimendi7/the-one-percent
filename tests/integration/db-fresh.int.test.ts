import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { auditDatabase, auditStructure } from "../../scripts/lib/rls-audit.mjs"
import { db } from "./setup"

/**
 * G2 · RLS audit of `npm run db:fresh`, against the LOCAL stack. The CI starts that stack by applying
 * every migration to an empty database, which is exactly what the script does on a new project:
 * here the result is audited the same way, and the audit is shown to catch what it must refuse.
 */
const files = readdirSync("supabase/migrations")

describe("fresh database audit", () => {
  it("every migration applied to an empty database passes the audit", async () => {
    const report = await db((c) => auditDatabase(c, { migrationFiles: files }))
    expect(report.problems).toEqual([])
    expect(report.tables).toBeGreaterThanOrEqual(25)
    expect(report.migrations).toBe(files.filter((f) => f.endsWith(".sql")).length)
  })

  it("refuses a table without RLS, a policy for anon, a view and a missing migration", async () => {
    const problems = await db(async (c) => {
      await c.query("begin")
      try {
        await c.query("create table public.it_no_rls (id int)")
        await c.query("create table public.it_anon (id int)")
        await c.query("alter table public.it_anon enable row level security")
        await c.query("create policy it_anon_read on public.it_anon for select to anon using (true)")
        await c.query("create view public.it_view as select 1 as x")
        return (await auditStructure(c, { migrationFiles: [...files, "29991231000000_future.sql"] })).problems
      } finally {
        await c.query("rollback")
      }
    })
    expect(problems).toEqual(
      expect.arrayContaining([
        "la tabla public.it_no_rls no tiene RLS",
        "la política «it_anon_read» de public.it_anon no es solo para authenticated ({anon})",
        "la política «it_anon_read» de public.it_anon no depende de auth.uid()",
        "la vista public.it_view se salta RLS (falta security_invoker)",
        "falta la migración 29991231000000 en el historial de la base",
      ])
    )
  })
})
