import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Atelier — Administration', template: '%s — Atelier' },
  description: 'Portail d\'administration multi-clients',
  robots: { index: false, follow: false },  // jamais indexé
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen">{children}</body>
    </html>
  )
}
