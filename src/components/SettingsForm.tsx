'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { saveSiteSettings } from '@/app/admin/actions-site'

interface SettingsFormProps {
  tenantSlug: string
  canEdit: boolean
  initial: {
    contact: Record<string, string>
    social: Record<string, string>
    hours: Record<string, string>
    seo: Record<string, string>
  }
}

const FIELDS = {
  contact: [
    ['phone', 'Téléphone'],
    ['whatsapp', 'WhatsApp (numéro international)'],
    ['email', 'E-mail'],
    ['address', 'Adresse'],
    ['city', 'Ville'],
    ['country', 'Pays'],
  ],
  social: [
    ['facebook', 'Facebook'],
    ['instagram', 'Instagram'],
    ['tiktok', 'TikTok'],
  ],
  hours: [
    ['weekdays', 'En semaine'],
    ['saturday', 'Samedi'],
    ['sunday', 'Dimanche'],
  ],
  seo: [
    ['title', 'Titre par défaut'],
    ['description', 'Description par défaut'],
  ],
} as const

const LABELS: Record<keyof typeof FIELDS, string> = {
  contact: 'Contact',
  social: 'Réseaux sociaux',
  hours: 'Horaires',
  seo: 'Référencement',
}

export default function SettingsForm({ tenantSlug, canEdit, initial }: SettingsFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function onSubmit(formData: FormData) {
    setError(null); setSaved(false)

    const payload = Object.fromEntries(
      Object.keys(FIELDS).map((group) => [
        group,
        Object.fromEntries(
          FIELDS[group as keyof typeof FIELDS].map(([name]) => [
            name, String(formData.get(`${group}.${name}`) ?? ''),
          ]),
        ),
      ]),
    )

    startTransition(async () => {
      const res = await saveSiteSettings(tenantSlug, payload)
      if (!res.ok) { setError(res.error); return }
      setSaved(true)
      router.refresh()
    })
  }

  return (
    <form action={onSubmit} className="space-y-5">
      {error ? (
        <p role="alert" className="card p-4 text-sm"
           style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}>{error}</p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="card p-4 text-sm"
           style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}>
          Enregistré. Le site se reconstruira dans quelques minutes.
        </p>
      ) : null}

      {(Object.keys(FIELDS) as (keyof typeof FIELDS)[]).map((group) => (
        <fieldset key={group} className="card p-5" disabled={!canEdit || pending}>
          <legend className="label" style={{ color: 'var(--muted)' }}>{LABELS[group]}</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {FIELDS[group].map(([name, label]) => (
              <label key={name} className="block">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{label}</span>
                <input
                  name={`${group}.${name}`}
                  defaultValue={initial[group]?.[name] ?? ''}
                  className="mt-1 w-full rounded-xl border bg-transparent px-4 py-2.5 text-sm"
                  style={{ borderColor: 'var(--border)' }}
                />
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      {canEdit ? (
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      ) : null}
    </form>
  )
}
