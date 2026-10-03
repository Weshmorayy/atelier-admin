'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import { signInAction } from '@/app/login-actions'

/**
 * Page de connexion — e-mail + mot de passe.
 *
 * Aligné sur `scripts/bootstrap.mjs`, qui crée le compte avec un mot de passe.
 *
 * À noter pour plus tard : un lien magique par courriel supprimerait la
 * réinitialisation de mot de passe, mais exige un SMTP fonctionnel. Tant que
 * l'envoi de courriel n'est pas configuré, le mot de passe est le seul chemin
 * qui fonctionne — et mieux vaut un chemin qui marche qu'un chemin élégant.
 */

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const next = params.get('next') ?? '/admin'

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    startTransition(async () => {
      // L'action tourne côté serveur : le module d'auth (et `postgres`)
      // ne touchent jamais le bundle du navigateur.
      const fd = new FormData()
      fd.set('email', email)
      fd.set('password', password)
      fd.set('next', next)

      const res = await signInAction({ error: null }, fd)
      if (res.error) { setError(res.error); return }

      router.push(next)
      router.refresh()
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="label" style={{ color: 'var(--accent-text)' }}>Atelier</p>
          <h1 className="page-title mt-2">Administration</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            Connectez-vous pour gérer votre site.
          </p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {error ? (
            <p role="alert" className="text-sm" style={{ color: 'var(--accent-text)' }}>
              {error}
            </p>
          ) : null}

          <label className="block">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Adresse e-mail
            </span>
            <input
              type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="vous@entreprise.sn" className="field mt-1"
            />
          </label>

          <label className="block">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              Mot de passe
            </span>
            <input
              type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              className="field mt-1"
            />
          </label>

          <button type="submit" disabled={pending} className="btn-primary w-full">
            {pending ? (
              <><Loader2 size={16} className="animate-spin" /> Connexion…</>
            ) : 'Se connecter'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs" style={{ color: 'var(--muted)' }}>
          Accès réservé. Les comptes sont créés par l&apos;agence.
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  )
}