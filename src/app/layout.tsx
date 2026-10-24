import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BootFallback, HydrationMark } from "@/components/shell/boot"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "The One Percent",
    template: "%s · The One Percent",
  },
  description: "Sistema operativo personal de rendimiento: hábitos, enfoque, conocimiento y reflexión.",
  applicationName: "The One Percent",
  appleWebApp: {
    capable: true,
    title: "One Percent",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  // Private app: never index.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-center" offset={16} mobileOffset={{ top: 64 }} />
        <HydrationMark />
        <BootFallback />
      </body>
    </html>
  )
}
