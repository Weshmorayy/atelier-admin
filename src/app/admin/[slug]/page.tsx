import { redirect } from 'next/navigation'
import { resolveSession } from '@/core/session'
import { allModules } from '@/core/modules'

export const dynamic = 'force-dynamic'

/** Tableau de bord d'un tenant : uniquement ses modules actifs. */
export default async function TenantHome({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await resolveSession(slug)
  if (!session) redirect('/connexion')

  const { tenant } = session
  const active = allModules().filter((m) => tenant.modules.includes(m.key))

  return (
    <div>
      <p className="label" style={{ color: 'var(--accent-text)' }}>{tenant.name}</p>
      <h1 className="mt-1 text-2xl font-semibold">Tableau de bord</h1>

      <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
        {active.length} module{active.length > 1 ? 's' : ''} actif{active.length > 1 ? 's' : ''}
        {active.length > 1 ? ' sur ' : ' sur '}{allModules().length} disponibles.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((m) => (
          <div key={m.key} className="card p-5">
            <h2 className="font-semibold">{m.label}</h2>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--muted)' }}>{m.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
