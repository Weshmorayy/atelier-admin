import { redirect } from 'next/navigation'
import { sql } from 'drizzle-orm'
import { resolveSession } from '@/core/session'
import { getDb } from '@/db'
import { permissionAllowed } from '@/core/modules'
import SettingsForm from '@/components/SettingsForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await resolveSession(slug)

  if (!session) redirect('/connexion')

  const canEdit = permissionAllowed(
    session.tenant.modules, 'settings', 'manage-settings',
  )

  // Lecture : passe par withTenant pour que le RLS filtre, même si le tenant
  // est déjà résolu — on ne court-circuite pas l'isolation par commodité.
  const rows = (await getDb().execute(sql`
    SELECT contact, social, hours, seo FROM site_settings
     WHERE tenant_id = ${session.tenant.id} LIMIT 1
  `)) as unknown as Record<string, unknown>[]

  const s = (rows[0] ?? {}) as {
    contact?: Record<string, string>
    social?: Record<string, string>
    hours?: Record<string, string>
    seo?: Record<string, string>
  }

  return (
    <div>
      <p className="label" style={{ color: 'var(--accent-text)' }}>Site</p>
      <h1 className="mt-1 mb-8 text-2xl font-semibold">Contacts &amp; réglages</h1>

      {!canEdit ? (
        <p className="card mb-6 p-4 text-sm" style={{ color: 'var(--muted)' }}>
          Seul le propriétaire du site peut modifier ces informations.
        </p>
      ) : null}

      <SettingsForm
        tenantSlug={slug}
        canEdit={canEdit}
        initial={{
          contact: s.contact ?? {},
          social: s.social ?? {},
          hours: s.hours ?? {},
          seo: s.seo ?? {},
        }}
      />
    </div>
  )
}
