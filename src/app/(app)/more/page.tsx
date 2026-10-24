import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { MORE_NAV } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"

export const metadata: Metadata = { title: "Más" }

export default function MorePage() {
  return (
    <>
      <PageHeader title="Más" />
      <div className="space-y-6">
        {MORE_NAV.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="mb-2 px-1 text-xs font-medium text-text-tertiary">{group.label}</h2>
            <ul className="panel divide-y divide-border/70 overflow-hidden rounded-2xl">
              {group.items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link href={href} className="flex min-h-14 items-center gap-3.5 px-4 transition-colors hover:bg-surface-raised/50 active:bg-surface-raised">
                    <span className="grid size-9 place-items-center rounded-[10px] bg-surface-raised">
                      <Icon className="size-[18px] text-text-secondary" strokeWidth={1.75} aria-hidden />
                    </span>
                    <span className="flex-1 text-[0.9375rem] font-medium">{label}</span>
                    <ChevronRight className="size-4 text-text-tertiary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
