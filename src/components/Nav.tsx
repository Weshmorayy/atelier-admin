import Link from 'next/link'
import {
  Settings, Package, FolderTree, Image, LayoutTemplate, HelpCircle,
  Newspaper, Inbox, FolderOpen, BarChart3, CreditCard, type LucideIcon,
} from 'lucide-react'
import { buildNav, type ModuleKey } from '@/core/modules'

const ICONS: Record<string, LucideIcon> = {
  Settings, Package, FolderTree, Image, LayoutTemplate,
  HelpCircle, Newspaper, Inbox, FolderOpen, BarChart3, CreditCard,
}

const GROUP_LABEL = {
  contenu: 'Contenu',
  commerce: 'Commerce',
  technique: 'Technique',
} as const

/**
 * Navigation derivée du registre de modules.
 *
 * Aucun module n'est codé en dur ici : la liste affichée est exactement
 * l'intersection entre le registre et les modules ACTIFS du tenant. Un site
 * sans blog n'affiche pas « Blog », sans qu'aucune condition ne soit écrite.
 */
export default function Nav({
  tenantSlug,
  enabled,
  active,
}: {
  tenantSlug: string
  enabled: ModuleKey[]
  active?: string
}) {
  const groups = buildNav(enabled)

  return (
    <nav className="flex flex-col gap-6" aria-label="Navigation de l'administration">
      {(Object.keys(GROUP_LABEL) as (keyof typeof GROUP_LABEL)[]).map((g) => {
        const items = groups[g]
        if (items.length === 0) return null
        return (
          <div key={g}>
            <p className="label px-3" style={{ color: 'var(--muted)' }}>
              {GROUP_LABEL[g]}
            </p>
            <ul className="mt-2 flex flex-col gap-0.5">
              {items.map((m) => {
                const Icon = ICONS[m.icon] ?? Package
                const href = `/admin/${tenantSlug}${m.adminRoutes[0].replace('/admin', '')}`
                const isActive = active === m.key
                return (
                  <li key={m.key}>
                    <Link
                      href={href}
                      aria-current={isActive ? 'page' : undefined}
                      className={`nav-item${isActive ? ' nav-item-active' : ''}`}
                    >
                      <Icon size={17} strokeWidth={1.6} aria-hidden />
                      {m.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
