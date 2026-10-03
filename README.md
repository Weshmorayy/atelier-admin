# Atelier Admin — portail partagé multi-clients

Un seul back-office pour tous les sites clients. Un client = un **tenant**.

## Principes

1. **Le navigateur ne décide de rien.** Toute écriture passe par une route serveur
   authentifiée. La base n'est jamais exposée au client.
2. **Aucun fork.** Le code n'est pas dupliqué par client : ce qui varie vit en
   base (contenu, modules, thème) ou dans un fichier de config typé.
3. **Chaque mutation est traçable.** Audit écrit dans la même transaction.
4. **Français d'abord**, y compris l'interface.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Drizzle 0.45 · Postgres ·
Better Auth 1.7 · Zod 4 · MinIO (S3) · Umami (stats, optionnel)

## Isolation

Schéma partagé, `tenant_id` sur toutes les tables métier, **RLS forcée**
(`FORCE ROW LEVEL SECURITY` — sans elle, PostgreSQL fait confiance au
propriétaire des tables et saute les politiques).

Rôles : `viewer` < `editor` < `manager` < `owner`, plus `superadmin`
(transverse, réservé à l'agence).

Toute requête passe par `withTenant()` (`src/db/index.ts`), qui positionne les
variables de session lues par les politiques. Le `tenantId` vient **toujours**
de la session résolue côté serveur, jamais d'un paramètre.

## Système de modules

Les **types** de modules sont dans `src/core/modules.ts` (temps de compilation :
ils conditionnent le schéma, les routes, les permissions). L'**activation** vit
dans `tenants.modules`.

Conséquence : « ce site n'a pas de blog » se règle en un drapeau, sans
redéploiement. Le site client ne rend un bloc que si le slot figure dans les
modules actifs du tenant.

## Thèmes

`src/core/theme.ts`. Un thème = des tokens → variables CSS. Le même jeu de
composants sert le site ET l'admin.

Thème `mg-perfume` : **reconstitué à l'identique** depuis le portail existant,
dont le client MG est familier. Extrait de `SPEC_ADMIN_MG.md`.

## Chaîne complète : admin → rebuild → site

```
Commerçant enregistre  →  action auditée  →  POST /api/deploy-hook
   →  Coolify reconstruit  →  le site appelle /api/content/<tenant> au build
```

`/api/deploy-hook` est protégé par DEPLOY_HOOK_SECRET (comparaison à temps
constant) ET par la session. Sans le premier, quiconque ouvre la page peut
provoquer des reconstructions en boucle.

## Vérifier l'isolation

`src/db/test_rls.sql` simule deux applications, deux tenants, et vérifie huit
propriétés : échec fermé sans contexte, cloisonnement en lecture, refus d'écriture
hors tenant, `viewer` ne peut pas écrire, `editor` ne peut pas supprimer,
`superadmin` traverse, journal en ajout seul.

```bash
psql "$DATABASE_URL" -f src/db/test_rls.sql
```

> Rappel : RLS est **inopérante** si l'application se connecte en propriétaire
> des tables. D'où `FORCE ROW LEVEL SECURITY` et le rôle `atelier_app`.
>
> **Exécuté le 3 octobre 2026 sur PostgreSQL 18.6** — 10 contrôles, tous verts.
> Voir « Ce que le test a corrigé » ci-dessous : deux de nos hypothèses
> étaient fausses.

### Ce que le test a corrigé

En l'écrivant, on croyait que toute violation de RLS lève une erreur. C'est faux,
et l'écart est important :

| Opération | Mécanisme RLS | Comportement réel |
|---|---|---|
| `INSERT` vers un autre tenant | `WITH CHECK` | Postgres **lève** une erreur |
| `DELETE` par un rôle trop faible | `USING` | **Zéro ligne supprimée, en silence** |

Un `DELETE` non autorisé ne lève donc rien. Un test qui attend une exception
passe alors que la suppression a eu lieu. La propriété de sécurité à vérifier
est que **la ligne survit**, pas l'absence d'erreur — c'est désormais ce que le
test contrôle.

## Consommer le contenu depuis un site client

```ts
import { getSiteContent, bannersForSlot } from './content'

const content = await getSiteContent('continental')
const hero = bannersForSlot(content, 'hero')
```

- mode `build` — au build (SSG), rebuild déclenché par l'admin via deploy hook
- mode `live` — à chaque requête (SSR)

## Commandes

```bash
npm run dev            # développement
npm run type-check     # tsc
npm run build          # build de production
npm run db:generate    # drizzle-kit generate (migrations)
npm run db:migrate     # applique les migrations (MIGRATION_DATABASE_URL)
```

⚠ L'application doit se connecter avec `DATABASE_URL` (rôle **non propriétaire**).
`MIGRATION_DATABASE_URL` (propriétaire) est réservé à `drizzle-kit`.

## Déploiement

Coolify, même VPS que les sites. L'admin a son propre domaine ; chaque client a
un sous-domaine résolu vers son tenant via `tenant_domains`.
