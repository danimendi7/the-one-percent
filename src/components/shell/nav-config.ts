import {
  Activity,
  Bell,
  Brain,
  Compass,
  Flag,
  Gauge,
  Home,
  LayoutGrid,
  Library,
  ListChecks,
  NotebookPen,
  Settings,
  Sparkles,
  Timer,
  type LucideIcon,
} from "lucide-react"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Pathname prefixes that mark this item as active */
  match?: string[]
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

/** Desktop sidebar (PRD §3). */
export const SIDEBAR_NAV: NavGroup[] = [
  {
    items: [
      { href: "/", label: "Resumen", icon: Home },
      { href: "/habits", label: "Hábitos", icon: ListChecks },
      { href: "/analytics", label: "Analítica", icon: Gauge },
      { href: "/goals", label: "Objetivos", icon: Flag },
      { href: "/focus", label: "Enfoque", icon: Timer },
    ],
  },
  {
    label: "Conocimiento",
    items: [
      { href: "/knowledge/library", label: "Biblioteca", icon: Library },
      { href: "/knowledge/discover", label: "Descubrir", icon: Compass },
      { href: "/knowledge/brain", label: "Cerebro", icon: Brain },
    ],
  },
  {
    label: "Reflexión",
    items: [
      { href: "/mind", label: "Mente y energía", icon: Activity },
      { href: "/reviews", label: "Revisiones", icon: NotebookPen },
      { href: "/intelligence", label: "Inteligencia", icon: Sparkles },
    ],
  },
]

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Ajustes", icon: Settings }

/** Mobile bottom tabs (PRD §3): Home, Habits, Focus, Insights, More. */
export const BOTTOM_TABS: NavItem[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/habits", label: "Hábitos", icon: ListChecks },
  { href: "/focus", label: "Enfoque", icon: Timer },
  { href: "/analytics", label: "Análisis", icon: Gauge },
  {
    href: "/more",
    label: "Más",
    icon: LayoutGrid,
    match: ["/more", "/knowledge", "/goals", "/mind", "/reviews", "/intelligence", "/settings"],
  },
]

/** Sections surfaced by the mobile "More" screen. */
export const MORE_NAV: NavGroup[] = [
  {
    label: "Conocimiento",
    items: [
      { href: "/knowledge/library", label: "Biblioteca", icon: Library },
      { href: "/knowledge/discover", label: "Descubrir", icon: Compass },
      { href: "/knowledge/brain", label: "Cerebro", icon: Brain },
    ],
  },
  {
    label: "Progreso",
    items: [
      { href: "/goals", label: "Objetivos", icon: Flag },
      { href: "/reviews", label: "Revisiones", icon: NotebookPen },
      { href: "/mind", label: "Mente y energía", icon: Activity },
      { href: "/intelligence", label: "Inteligencia", icon: Sparkles },
    ],
  },
  {
    label: "Cuenta",
    items: [
      { href: "/settings", label: "Ajustes", icon: Settings },
      { href: "/settings/notifications", label: "Notificaciones", icon: Bell },
    ],
  },
]

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.match?.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true
  if (item.href === "/") return pathname === "/"
  return pathname === item.href || pathname.startsWith(item.href + "/")
}

export const ALL_ROUTES: string[] = [
  ...new Set([
    ...SIDEBAR_NAV.flatMap((g) => g.items.map((i) => i.href)),
    SETTINGS_NAV.href,
    ...BOTTOM_TABS.map((i) => i.href),
    ...MORE_NAV.flatMap((g) => g.items.map((i) => i.href)),
  ]),
]
