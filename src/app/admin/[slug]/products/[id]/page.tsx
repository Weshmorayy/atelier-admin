import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { resolveSession } from '@/core/session'
import { permissionAllowed, roleAllows } from '@/core/modules'
import { getProductForEdit } from '@/app/admin/actions'
import ProductForm from '@/components/ProductForm'

export const dynamic = 'force-dynamic'

/**
 * Édition d'un produit existant.
 *
 * L'identifiant vient de l'URL, le tenant vient de la session. Si l'un des deux
 * ne correspond pas, la requête ne renvoie rien : c'est RLS qui le décide,
 * pas une comparaison faite ici.
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const session = await resolveSession(slug)

  if (!session) redirect('/connexion')
  if (!permissionAllowed(session.tenant.modules, 'products', 'update')) {
    redirect(`/admin/${slug}/products`)
  }

  const row = await getProductForEdit(slug, id)
  if (!row) notFound()

  const canDelete =
    permissionAllowed(session.tenant.modules, 'products', 'delete') &&
    roleAllows(session.ctx.role, 'delete')

  return (
    <div className="max-w-3xl">
      <Link
        href={`/admin/${slug}/products`}
        className="label inline-flex items-center gap-1.5"
        style={{ color: 'var(--muted)' }}
      >
        <ArrowLeft size={13} strokeWidth={2} aria-hidden /> Catalogue
      </Link>

      <h1 className="page-title mt-3 mb-1">{String(row.name)}</h1>
      <p className="mb-8 text-sm" style={{ color: 'var(--muted)' }}>
        {Number(row.price).toLocaleString('fr-FR')} FCFA
        {row.is_active ? '' : ' · masqué du site'}
      </p>

      <ProductForm
        tenantSlug={slug}
        canDelete={canDelete}
        product={{
          id: String(row.id),
          name: String(row.name),
          slug: String(row.slug),
          brand: (row.brand as string | null) ?? null,
          price: String(row.price),
          image: (row.image as string | null) ?? null,
          imageAlt: (row.image_alt as string | null) ?? null,
          shortDesc: (row.short_desc as string | null) ?? null,
          badge: (row.badge as string | null) ?? null,
          inStock: Boolean(row.in_stock),
          isActive: Boolean(row.is_active),
        }}
      />
    </div>
  )
}