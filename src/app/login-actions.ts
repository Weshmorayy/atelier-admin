'use server'

import { auth } from '@/core/auth'

/**
 * Connexion — exécutée côté serveur.
 *
 * Le formulaire ne doit JAMAIS importer `@/core/auth` : ce module tire
 * `postgres`, qui est un module Node (`net`, `tls`). L'importer depuis un
 * composant client casse le build et, s'il passait, exposerait la chaîne de
 * connexion dans le navigateur. Les identifiants transitent par l'action, pas
 * par le bundle.
 */
export async function signInAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/admin')

  if (!email || !password) {
    return { error: 'Renseignez votre adresse et votre mot de passe.' }
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: new Headers(await import('next/headers').then((h) => h.headers()).then((h) => h)),
      asResponse: true,
    })
  } catch {
    // Message volontairement générique : distinguer « e-mail inconnu » de
    // « mot de passe faux » permettrait d'énumérer les comptes existants.
    return { error: 'Identifiants invalides.' }
  }

  return { error: null }
}
