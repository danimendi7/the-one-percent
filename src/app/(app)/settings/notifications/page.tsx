import type { Metadata } from "next"
import { NotificationSettings } from "@/features/notifications/notification-settings"

export const metadata: Metadata = { title: "Notificaciones" }

export default function NotificationsPage() {
  return <NotificationSettings />
}
