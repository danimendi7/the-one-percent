"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BOTTOM_TABS, isActive } from "./nav-config"

/** Mobile bottom navigation (<768px): five tabs, safe-area aware. */
export function BottomTabs() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Navegación principal"
      className="pb-safe fixed inset-x-0 bottom-0 z-(--z-nav) border-t border-border bg-background/88 backdrop-blur-xl md:hidden"
    >
      <ul className="grid h-(--bottom-tabs-h) grid-cols-5">
        {BOTTOM_TABS.map((item) => {
          const active = isActive(pathname, item)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
                  active ? "text-foreground" : "text-text-tertiary"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150",
                    active && "bg-surface-raised"
                  )}
                >
                  <Icon className={cn("size-5", active && "text-signal")} strokeWidth={active ? 2 : 1.75} />
                </span>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
