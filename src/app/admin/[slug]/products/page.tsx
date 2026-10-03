import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { resolveSession } from '@/core/session'
import { listProducts } from '@/app/admin/actions'
import { permissionAllowed } from '@/core/modules'

export const dynamic = 'force-dynamic'

/**
 * Liste des produits d'un tenant.
 *
 * Le module peut être désactivé : dans ce cas la page n'existe pas pour ce
 * tenant. Aucune donnée n'est lue — le garde est avant la requête, pas après.
 */
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await resolveSession(slug)

  if (!session) redirect('/connexion')
  if (!permissionAllowed(session.tenant.modules, 'products', 'read')) redirect(`/admin/${slug}`)

  const products = await listProducts(slug)
  const canEdit = permissionAllowed(session.tenant.modules, 'products', 'update')
  const canDelete = permissionAllowed(session.tenant.modules, 'products', 'delete')

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label" style={{ color: 'var(--accent-text)' }}>Catalogue</p>
          <h1 className="mt-1 text-2xl font-semibold">Produits</h1>
        </div>
        {canEdit ? (
          <Link href={`/admin/${slug}/products/nouveau`} className="btn-primary">
            Nouveau produit
          </Link>
        ) : (
          <span className="label" style={{ color: 'var(--muted)' }}>Lecture seule</span>
        )}
      </div>

      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        {products.length} produit{products.length > 1 ? 's' : ''}
      </p>

      {products.length === 0 ? (
        <div className="card mt-6 p-10 text-center">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Aucun produit pour le moment.
          </p>
        </div>
      ) : (
        <div className="card mt-6 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--muted)' }}>
                {['Produit', 'Catégorie', 'Prix', 'Stock', 'État', ''].map((h) => (
                  <th key={h} className="label px-4 py-3 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const active = p.is_active as boolean
                const inStock = p.in_stock as boolean
                return (
                  <tr key={String(p.id)} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg"
                          style={{ background: 'var(--accent-soft)' }}
                        >
                          {p.image ? (
                            <Image src={String(p.image)} alt="" width={40} height={40}
                              className="h-full w-full object-contain" />
                          ) : (
                            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>—</span>
                          )}
                        </span>
                        <span className="font-medium">{String(p.name)}</span>
                        {p.badge ? (
                          <span className="label rounded-full px-2 py-0.5"
                            style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>
                            {String(p.badge)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>
                      {p.category_slug ? String(p.category_slug) : '—'}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">
                      {Number(p.price).toLocaleString('fr-FR')} FCFA
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ color: inStock ? 'var(--body)' : 'var(--accent-text)' }}>
                        {inStock ? 'En stock' : 'Rupture'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="label rounded-full px-2 py-0.5"
                        style={{
                          background: active ? 'var(--accent-soft)' : 'transparent',
                          color: active ? 'var(--accent-text)' : 'var(--muted)',
                          border: '1px solid var(--border)',
                        }}>
                        {active ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit ? <span className="label">Modifier</span> : null}
                      {canDelete ? <span className="label ml-3">Supprimer</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
