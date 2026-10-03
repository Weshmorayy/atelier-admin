/**
 * auth.ts — Better Auth, self-hosted.
 *
 * Choix : Better Auth plutôt que NextAuth (absorbé par Better Auth en sept. 2025,
 * passé en maintenance, pas de v5 prévue) ou Lucia (déprécié).
 *
 * MODÈLE : une « organisation » = un site client.
 *  - le staff agence est `owner` sur chaque org client + rôle superadmin
 *  - le commerçant est `owner` de SA propre org
 *
 * Toutes les permissions sont vérifiées côté serveur. `hasPermission` et non
 * `checkRolePermission` : cette dernière ignore les rôles dynamiques.
 */

import { betterAuth } from 'better-auth'
import { organization, admin as adminPlugin } from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'
import postgres from 'postgres'

/**
 * SECRET — pas d'échec à l'import.
 *
 * Le build Next.js importe les modules pour collecter les données de page.
 * Lever ici faisait échouer le déploiement sur Vercel/Coolify dès qu'une
 * variable d'environnement manquait — un échec de build, pas une erreur
 * d'authentification, et donc impossible à diagnostiquer sur place.
 *
 * On fournit donc un substitut explicite au build, et on vérifie au premier
 * usage réel. En production, l'absence de secret fait échouer la requête avec
 * un message actionnable au lieu de démarrer silencieusement avec une clé
 * faible — ce qui rendrait les sessions falsifiables.
 */
const PLACEHOLDER_SECRET = 'atelier-admin-unconfigured-secret-build-time-only'

function resolveSecret(): string {
  const s = process.env.BETTER_AUTH_SECRET
  return s && s.trim() !== '' ? s : PLACEHOLDER_SECRET
}

/** À appeler avant tout usage réel de l'authentification. */
export function assertAuthConfigured(): void {
  if (resolveSecret() === PLACEHOLDER_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET absent. Définissez-la dans l'environnement de production " +
      '(Coolify → Variables, ou Vercel → Environment Variables). ' +
      'Générez-la avec : openssl rand -base64 32',
    )
  }
}

const client = postgres(process.env.DATABASE_URL ?? 'postgres://localhost:5432/atelier', {
  max: 5,
  prepare: false,
})

export const auth = betterAuth({
  database: client,
  secret: resolveSecret(),

  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL,

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: process.env.NODE_ENV === 'production',
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,   // 7 jours
    updateAge: 60 * 60 * 24,       // renouvelé chaque jour
  },

  advanced: {
    // L'admin doit être derrière HTTPS en production (Coolify le gère).
    useSecureCookies: process.env.NODE_ENV === 'production',
  },

  plugins: [
    organization({
      allowUserToCreateOrganizations: false, // seules l'agence en crée
      organizationLimit: 1,                  // un utilisateur = une org cliente
    }),
    adminPlugin(),
    nextCookies(),
  ],

  // Rôles disponibles dans le système. `superadmin` est réservé à l'agence :
  // il donne accès transversal à tous les tenants.
  user: {
    additionalFields: {
      isSuperAdmin: { type: 'boolean', defaultValue: false, input: false },
    },
  },
})

/**
 * Better Auth 1.7 expose `auth.handler` (une fonction) et `auth.api.*`
 * (`getSession`, `signOut`, `signInEmail`, …). Les types de session se
 * déduisent de `auth.$Infer` — pas d'export `handlers` ni `getSession` directs,
 * contrairement à ce que montrent beaucoup d'exemples plus anciens.
 */
export type Session = typeof auth.$Infer.Session
export type SessionUser = typeof auth.$Infer.Session.user

/** Lecture de session côté serveur. */
export const getSession = (headers: Headers) => auth.api.getSession({ headers })