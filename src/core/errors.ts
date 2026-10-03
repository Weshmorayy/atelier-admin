/**
 * errors.ts — Erreurs métier de l'administration.
 *
 * Séparé de `actions.ts` parce qu'un fichier `'use server'` ne peut exporter
 * QUE des fonctions asynchrones : exporter une classe y casse le build.
 */

export class ForbiddenError extends Error {
  constructor() {
    super("Vous n'avez pas les droits nécessaires pour cette action.")
    this.name = 'ForbiddenError'
  }
}

/**
 * Traduit une erreur technique en message utilisable par un commerçant.
 * Les violations RLS sont traduites explicitement : elles remontent brutes et
 * seraient incompréhensibles (« row-level security »).
 */
export function toMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  if (err instanceof ForbiddenError) return raw
  if (/row-level security|violates/i.test(raw)) {
    return "Ce tenant n'a pas le droit d'effectuer cette action."
  }
  if (/duplicate key|unique/i.test(raw)) {
    return 'Cette valeur existe déjà (slug en double ?).'
  }
  if (/invalid input syntax for type uuid/i.test(raw)) {
    return 'Identifiant invalide.'
  }
  return 'Une erreur est survenue. Réessayez.'
}
