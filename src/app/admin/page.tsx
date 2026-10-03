import Link from 'next/link'
import { allModules, defaultModuleKeys, type ModuleKey } from '@/core/modules'

export const dynamic = 'force-dynamic'

/**
 * Écran d'accueil de l'admin.
 *
 * Voluntary simple : tant que la session n'est pas branchée, cette page montre
 * le registre de modules — ce qui documente le système et permet de vérifier
 * que le registre compile et se rend.
 */
export default function AdminHome() {
  const defaults = new Set<ModuleKey>(defaultModuleKeys())

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="label" style={{ color: 'var(--accent-text)' }}>Atelier</p>
      <h1 className="mt-2 text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
        Portail d&apos;administration
      </h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
        {allModules().length} modules disponibles. Un tenant n&apos;active que ceux
        dont il a besoin.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {allModules().map((m) => (
          <div key={m.key} className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{m.label}</h2>
              <span
                className="label rounded-full px-2.5 py-1"
                style={{
                  background: defaults.has(m.key) ? 'var(--accent-soft)' : 'transparent',
                  color: defaults.has(m.key) ? 'var(--accent-text)' : 'var(--muted)',
                  border: `1px solid var(--border)`,
                }}
              >
                {defaults.has(m.key) ? 'actif' : m.key}
              </span>
            </div>
            <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{m.description}</p>
            {m.requires?.length ? (
              <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
                Dépend de : {m.requires.join(', ')}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm" style={{ color: 'var(--muted)' }}>
        Authentification et console superadmin : phase suivante.{' '}
        <Link href="/admin/settings" className="underline">Réglages</Link>
      </p>
    </main>
  )
}
