import { BottomTabs } from "./bottom-tabs"
import { MobileHeader } from "./mobile-header"
import { SideNav } from "./side-nav"

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="canvas-glow relative min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-signal px-4 py-2 font-semibold text-signal-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Saltar al contenido
      </a>
      <SideNav />
      <div className="relative md:pl-[72px] lg:pl-60">
        <MobileHeader />
        <main
          id="main"
          className="mx-auto w-full max-w-[1400px] px-4 pt-5 pb-[calc(var(--bottom-tabs-h)+env(safe-area-inset-bottom)+2rem)] sm:px-6 md:pt-8 md:pb-16 lg:px-10"
        >
          {children}
        </main>
      </div>
      <BottomTabs />
    </div>
  )
}
