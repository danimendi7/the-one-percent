"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { BrandMark, BrandWordmark } from "./brand-mark"
import { isActive, SETTINGS_NAV, SIDEBAR_NAV, type NavItem } from "./nav-config"
import { SyncStatus } from "./sync-status"
import { FocusPill } from "@/features/focus/components/focus-pill"

/**
 * Desktop sidebar (≥1024px, 240px) that collapses to an icon rail on tablet (768–1023px).
 * The active item resolves behind Suspense: on routes with a runtime param the pathname is unknown
 * while prerendering, and the fallback is the same sidebar without an active item.
 */
export function SideNav() {
  return (
    <Suspense fallback={<Sidebar pathname="" />}>
      <ActiveSidebar />
    </Suspense>
  )
}

function ActiveSidebar() {
  return <Sidebar pathname={usePathname()} />
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-y-0 left-0 z-(--z-nav) hidden w-[72px] flex-col border-r border-sidebar-border bg-sidebar md:flex lg:w-60"
    >
      <div className="flex h-16 items-center px-[22px] lg:px-5">
        <Link href="/" aria-label="The One Percent, inicio" className="rounded-lg">
          <BrandMark className="lg:hidden" />
          <BrandWordmark className="hidden lg:flex" />
        </Link>
      </div>

      <div className="scrollbar-none flex-1 overflow-y-auto px-3 pb-4">
        {SIDEBAR_NAV.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-5")}>
            {group.label && (
              <p className="mb-1.5 hidden px-3 text-[0.6875rem] font-medium tracking-wide text-text-tertiary lg:block">
                {group.label}
              </p>
            )}
            {group.label && <div className="mx-auto mb-2 h-px w-6 bg-border lg:hidden" />}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-sidebar-border p-3">
        <div className="flex justify-center lg:block">
          <FocusPill rail className="lg:w-full" />
        </div>
        <NavLink item={SETTINGS_NAV} active={isActive(pathname, SETTINGS_NAV)} />
        <div className="flex justify-center lg:justify-start lg:px-1">
          <SyncStatus compact className="lg:w-full lg:justify-start" />
        </div>
      </div>
    </nav>
  )
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group relative flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150 lg:h-10 lg:justify-start",
            active
              ? "bg-surface-raised text-foreground"
              : "text-text-secondary hover:bg-surface hover:text-foreground"
          )}
        >
          {active && (
            <span aria-hidden className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full bg-signal" />
          )}
          <Icon className={cn("size-[18px] shrink-0", active ? "text-signal" : "text-text-tertiary group-hover:text-text-secondary")} strokeWidth={1.75} />
          <span className="sr-only lg:not-sr-only">{item.label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {item.label}
      </TooltipContent>
    </Tooltip>
  )
}
