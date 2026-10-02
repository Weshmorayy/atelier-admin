# AGENTS.md — Atelier Admin

> Règles spécifiques. Les règles générales de `~/atelier/AGENTS.md` s'appliquent aussi.

## Interdit

- ❌ Exposer une clé de base de données ou un `service_role` au navigateur
- ❌ Appeler `getDb()` sans passer par `withTenant()`
- ❌ Prendre le `tenantId` d'un paramètre, d'un body ou d'un en-tête client
- ❌ Retirer `FORCE ROW LEVEL SECURITY` (sans lui, l'isolation n'existe pas)
- ❌ Modifier `audit_events` (append-only, protégé par trigger)
- ❌ Forker ce dépôt par client — tout se règle par tenant ou thème
- ❌ Introduire du bleu : le brief client l'a refusé, thème MG exclu

## Obligatoire

- ✅ Toute migration en fichier `.sql` versionné, appliquée par script
- ✅ Écrire dans `audit_events` dans la même transaction que la mutation
- ✅ Vérifier une permission côté **serveur** (`auth.api.hasPermission`)
- ✅ Toute nouvelle table métier porte `tenant_id`, en tête de chaque index
- ✅ Nouvelle feature → module dans `src/core/modules.ts`, pas du `if` dispersé
- ✅ `npm run type-check` et `npm run build` propres avant push

## Direction Continental (pour mémoire)

Blanc, encre noire, accent terre cuite. Voir
`continental-website/.docs/[2]_DESIGN_GUIDE.md`.
