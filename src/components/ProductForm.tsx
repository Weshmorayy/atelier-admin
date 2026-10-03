'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, Upload, Loader2 } from 'lucide-react'
import { createProduct, updateProduct, type ProductActionResult } from '@/app/admin/actions'

/**
 * Formulaire produit — création et édition.
 *
 * L'image est téléversée DIRECTEMENT vers le stockage : le serveur signe
 * (`/api/media/presign`), le navigateur envoie le fichier, puis on enregistre
 * l'URL publique obtenue. Les octets ne passent jamais par Next.js.
 *
 * Le message d'erreur est celui renvoyé par l'action : RLS et permissions
 * sont traduits côté serveur. Le client ne réinvente aucun message.
 */

interface ProductFormProps {
  tenantSlug: string
  product?: {
    id: string
    name: string
    slug: string
    brand: string | null
    price: string
    image: string | null
    imageAlt: string | null
    shortDesc: string | null
    badge: string | null
    inStock: boolean
    isActive: boolean
  }
  /** Le rôle autorise-t-il la suppression ? */
  canDelete?: boolean
}

const MAX_BYTES = 5 * 1024 * 1024

export default function ProductForm({
  tenantSlug,
  product,
  canDelete = false,
}: ProductFormProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()

  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [image, setImage] = useState<string | null>(product?.image ?? null)
  const [imageAlt, setImageAlt] = useState(product?.imageAlt ?? '')
  const [deleting, setDeleting] = useState(false)

  async function onPickFile(file: File) {
    setError(null)

    if (file.size > MAX_BYTES) {
      setError('Image trop lourde (5 Mo maximum).')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image.')
      return
    }

    setUploading(true)
    try {
      // 1. demander une URL signée
      const presign = await fetch('/api/media/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          size: file.size,
          folder: 'products',
        }),
      })
      const signed = await presign.json()
      if (!presign.ok) throw new Error(signed?.error ?? 'Signature refusée')

      // 2. envoyer le fichier directement au stockage
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new Error('Téléversement refusé par le stockage')

      setImage(signed.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Téléversement impossible')
    } finally {
      setUploading(false)
    }
  }

  function onSubmit(formData: FormData) {
    setError(null)

    const payload = {
      name: String(formData.get('name') ?? ''),
      slug: String(formData.get('slug') ?? ''),
      brand: String(formData.get('brand') ?? '') || null,
      price: String(formData.get('price') ?? '0'),
      shortDesc: String(formData.get('shortDesc') ?? '') || null,
      badge: String(formData.get('badge') ?? '') || null,
      image,
      imageAlt: imageAlt || null,
      inStock: formData.get('inStock') === 'on',
      isActive: formData.get('isActive') === 'on',
      features: String(formData.get('features') ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    }

    startTransition(async () => {
      const res: ProductActionResult = product
        ? await updateProduct(tenantSlug, product.id, payload)
        : await createProduct(tenantSlug, payload)

      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push(`/admin/${tenantSlug}/products`)
      router.refresh()
    })
  }

  async function onDelete() {
    if (!product) return
    if (!window.confirm(`Supprimer « ${product.name} » ? Cette action est journalisée.`)) return

    setDeleting(true)
    const res = await (await import('@/app/admin/actions')).deleteProduct(
      tenantSlug, product.id,
    )
    if (!res.ok) setError(res.error)
    else { router.push(`/admin/${tenantSlug}/products`); router.refresh() }
    setDeleting(false)
  }

  return (
    <form action={onSubmit} className="space-y-6">
      {error ? (
        <p role="alert" className="card p-4 text-sm"
           style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}>
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="card p-5">
            <label className="label block" style={{ color: 'var(--muted)' }} htmlFor="name">Nom</label>
            <input id="name" name="name" required defaultValue={product?.name}
              className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }} />

            <label className="label mt-5 block" style={{ color: 'var(--muted)' }} htmlFor="slug">Slug</label>
            <input id="slug" name="slug" required defaultValue={product?.slug}
              placeholder="ventilateur-sur-pied-16"
              className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }} />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              Minuscules, chiffres et tirets. C'est l'adresse publique du produit.
            </p>
          </div>

          <div className="card p-5">
            <label className="label block" style={{ color: 'var(--muted)' }} htmlFor="shortDesc">Description courte</label>
            <textarea id="shortDesc" name="shortDesc" rows={3} defaultValue={product?.shortDesc ?? ''}
              className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }} />

            <label className="label mt-5 block" style={{ color: 'var(--muted)' }} htmlFor="features">
              Points forts (un par ligne)
            </label>
            <textarea id="features" name="features" rows={4}
              className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }} />
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <span className="label block" style={{ color: 'var(--muted)' }}>Image</span>

            <div className="mt-3 flex aspect-square items-center justify-center overflow-hidden rounded-xl"
                 style={{ background: 'var(--accent-soft)' }}>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs" style={{ color: 'var(--muted)' }}>Aucune image</span>
              )}
            </div>

            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f) }} />

            <button type="button" onClick={() => fileRef.current?.click()}
              disabled={uploading} className="btn-outline mt-3 w-full disabled:opacity-50">
              {uploading
                ? <><Loader2 size={16} className="animate-spin" /> Envoi…</>
                : <><Upload size={16} /> Choisir une image</>}
            </button>

            {image ? (
              <button type="button" onClick={() => setImage(null)}
                className="mt-2 text-xs underline" style={{ color: 'var(--muted)' }}>
                Retirer l'image
              </button>
            ) : null}

            <label className="label mt-5 block" style={{ color: 'var(--muted)' }} htmlFor="imageAlt">
              Texte alternatif
            </label>
            <input id="imageAlt" value={imageAlt} onChange={(e) => setImageAlt(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
              style={{ borderColor: 'var(--border)' }} />
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
              Décrit l'image pour les lecteurs d'écran. À renseigner.
            </p>
          </div>

          <div className="card space-y-4 p-5">
            <div>
              <label className="label block" style={{ color: 'var(--muted)' }} htmlFor="price">Prix (FCFA)</label>
              <input id="price" name="price" type="number" min="0" step="100" required
                defaultValue={product?.price ?? ''}
                className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm tabular-nums"
                style={{ borderColor: 'var(--border)' }} />
            </div>

            <div>
              <label className="label block" style={{ color: 'var(--muted)' }} htmlFor="brand">Marque</label>
              <input id="brand" name="brand" defaultValue={product?.brand ?? ''}
                className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
                style={{ borderColor: 'var(--border)' }} />
            </div>

            <div>
              <label className="label block" style={{ color: 'var(--muted)' }} htmlFor="badge">Badge</label>
              <input id="badge" name="badge" defaultValue={product?.badge ?? ''}
                placeholder="Bestseller"
                className="mt-1.5 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
                style={{ borderColor: 'var(--border)' }} />
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="inStock" defaultChecked={product?.inStock ?? true}
                className="h-4 w-4" />
              En stock
            </label>

            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={product?.isActive ?? true}
                className="h-4 w-4" />
              Visible sur le site
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || uploading} className="btn-primary disabled:opacity-50">
          {pending ? 'Enregistrement…' : product ? 'Enregistrer' : 'Créer le produit'}
        </button>

        {product && canDelete ? (
          <button type="button" onClick={onDelete} disabled={deleting}
            className="label rounded-full px-4 py-2.5 disabled:opacity-50"
            style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
            {deleting ? 'Suppression…' : 'Supprimer'}
          </button>
        ) : null}
      </div>
    </form>
  )
}