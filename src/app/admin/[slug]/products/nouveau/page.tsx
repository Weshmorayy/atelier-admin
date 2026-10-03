import { redirect } from 'next/navigation'
import { resolveSession } from '@/core/session'
import { permissionAllowed } from '@/core/modules'
import ProductForm from '@/components/ProductForm'

export const dynamic = 'force-dynamic'

export default async function NewProductPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await resolveSession(slug)

  if (!session) redirect('/connexion')
  if (!permissionAllowed(session.tenant.modules, 'products', 'create')) {
    redirect(`/admin/${slug}/products`)
  }

  return (
    <div>
      <p className="label" style={{ color: 'var(--accent-text)' }}>Catalogue</p>
      <h1 className="mt-1 mb-8 text-2xl font-semibold">Nouveau produit</h1>
      <ProductForm tenantSlug={slug} />
    </div>
  )
}
