# Atelier — Vision et plan de la plateforme multi-tenant

> Document de référence. Il décrit ce qu'Atelier est censé être, ce qui
> existe réellement au 05-10-2026, et ce qu'il reste à faire. Les faits
> marqués **[VÉRIFIÉ]** ont été relus dans le code ce jour-là ; tout le reste
> est une intention.

---

## 1. La vision

Atelier n'est pas « un site web ». C'est **l'outil de production d'un studio
qui vend des sites à des commerçants**.

L'agence ne vend pas du code : elle vend un site qui reste à jour tout seul,
avec un back-office que le commerçant comprend sans formation. La valeur est
dans le portail, pas dans le site. Un site est un livrable ; le portail est
l'actif.

```
                    ┌─────────────────────────────────────┐
                    │        CONSOLE AGENCE               │
                    │   /superadmin — tous les sites       │
                    │   activer un module, thème, domaine │
                    └──────────────────┬──────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
   ┌────▼─────┐                 ┌──────▼──────┐                 ┌─────▼────┐
   │ tenant A │                 │  tenant B   │                 │ tenant C │
   │Continental│                │  MG Perfume │                 │   …      │
   └────┬─────┘                 └──────┬──────┘                 └─────┬────┘
        │                              │                              │
   site + admin                 site + admin                 site + admin
   (dépôt propre)               (dépôt propre)               (dépôt propre)
```

### Les cinq principes

1. **Aucun client ne voit un autre client.** Pas par convention, pas par
   discipline de code : par la base. Une requête oubliée ne peut pas fuir.
2. **Aucune intervention en code pour un changement de contenu.** Un prix,
   une photo, un titre : tout passe par le portail.
3. **Un module s'active en une ligne d'interface**, pas par un déploiement.
4. **Aucune duplication de dépôt client.** Un client n'est pas un fork ;
   c'est un tenant plus un thème.
5. **Le site client et son back-office partagent une identité visuelle.** Un
   commerçant ne voit pas un outil étranger.

### Les trois modes de contenu

Un site client peut consommer le contenu de trois façons. Le mode est un
choix par tenant, pas par projet.

| Mode | Quand le site relit | Pour qui |
|---|---|---|
| `live` | à chaque requête | site à fort trafic, contenu qui change souvent |
| `build` | au build, via deploy hook | site statique, hébergement mutualisé |
| `local` | fichiers du dépôt | site vitrine simple, pas de back-office |

`live` et `build` passent tous deux par `GET /api/content/[tenant]`. C'est le
même contenu, deux moments de lecture.

---

## 2. Le point de bascule : deux systèmes coexistent aujourd'hui

C'est la décision la plus importante du projet, et elle n'est pas tranchée.

Il existe **deux back-offices** pour Continental :

| | `continental-website` (intégré) | `atelier-admin` (plateforme) |
|---|---|---|
| Base | Supabase `tbaizfoircknsznmpcvb`, projet **dédié** | Base PostgreSQL `atelier` |
| Auth | Supabase Auth + table `site_admins` | Better Auth + organisations |
| Permissions | `can_module()` par module, en JSONB | `app_role_at_least()`, 5 rôles |
| Multi-tenant | ❌ **aucun** — `site_admins` n'a pas de `tenant_id` | ✅ RLS forcé sur les 14 tables |
| Contenu éditorial | `content_blocks`, 57 blocs | `pages`, `banners` |
| Blog | ❌ absent | ✅ table `blog_posts` |
| Médiathèque | ✅ | ✅ `media` |
| Journal | ✅ `audit_events` | ✅ `audit_events`, append-only par trigger |
| Thème par client | ❌ figé dans le dépôt | ✅ `tenants.theme` + presets |

**[VÉRIFIÉ]** Le portail intégré fonctionne : 14 contrôles de permissions et
20 contrôles RLS passent, un produit ajouté depuis l'interface a bien sa page
publique et son image. Ce n'est pas une maquette.

**[VÉRIFIÉ]** La plateforme est plus avancée *architecturalement* — c'est la
seule des deux à avoir une vraie isolation multi-tenant.

### Les trois options

**A — Garder deux systèmes.** Chaque nouveau client choisit l'un des deux.
- *Pour* : aucun risque de régression sur ce qui marche.
- *Contre* : deux systèmes à maintenir, deux fois les corrections de
  sécurité, et le client « Continental » ne profite pas du blog ni des thèmes.

**B — Migrer Continental vers `atelier-admin`.** Le portail intégré devient
une entité séparée à ce client, et Continental rejoint la plateforme.
- *Pour* : une seule plateforme à maintenir, le blog et les thèmes
  deviennent disponibles, l'isolation est prouvée.
- *Contre* : migration de 6 produits + 57 blocs + les réglages + les
  statistiques, et une période où Continental est en maintenance.

**C — Porter les qualities d'`atelier-admin` dans le portail intégré.**
- *Pour* : pas de migration de données.
- *Contre* : exactement l'inverse de l'objectif « un seul portail ».

**Recommandation : B**, mais **pas maintenant**. Le portail intégré est
fiable et le site vit. Il faut d'abord livrer les manques de la plateforme
(§5), puis migrer Continental en une seule opération réversible. Voir la
phase 4.

---

## 3. Ce qui existe déjà

**[VÉRIFIÉ]** Tout ce qui suit a été relu dans le dépôt.

### Isolation

`src/db/rls.sql`, 309 lignes. C'est la pièce la plus importante du projet.

- Rôle applicatif `atelier_app` : **ne possède aucune table**, `NOBYPASSRLS`.
- `FORCE ROW LEVEL SECURITY` sur les 14 tables. Sans lui PostgreSQL fait
  confiance au propriétaire et **saute les policies** — l'erreur qui donne
  l'illusion d'un multi-tenant sécurisé.
- Fermeture par défaut : sans `app.current_tenant` positionnée, **aucune
  ligne n'est visible**. Une page vide plutôt qu'une fuite.
- Hiérarchie de rôles : `viewer < editor < manager < owner`, plus
  `superadmin` qui passe tout.
- `audit_events` en ajout seul : deux policies `USING (false)` **et** un
  trigger qui lève sur `UPDATE`/`DELETE`/`TRUNCATE`.
- Les tables Better Auth sont **volontairement hors RLS** : ce sont des
  tables d'identité globales. Documenté, etgrant sinon aucune connexion
  n'est possible (erreur 42501, très discrète).

### Résolution du tenant

Le problème de démarrage est résolu proprement. Il faut connaître le tenant
pour poser `app.current_tenant`, mais `tenants` est elle-même protégée.

```
app_resolve_tenant(slug)        → SECURITY DEFINER, ne rend QUE slug → id
app_resolve_tenant_by_host(host)→ idem, via tenant_domains
```

Volontairement étroites : pas de `SELECT` générique, pas de nom de colonne en
paramètre. Une fonction large de ce type deviendrait un contournement du RLS.

### Modules

`src/core/modules.ts`. Les **types** vivent au temps de compilation, seule
l'**activation** vit en base (`tenants.modules`).

```ts
'settings' 'products' 'categories' 'banners' 'pages'
'faq' 'blog' 'leads' 'media' 'analytics' 'payments'
```

Un `ModuleDef` porte libellé, description, icône, **tables SQL touchées**,
permissions requises et routes admin. C'est ce qui permet à une interface de
dire « ce module utilise ces tables » avant de le désactiver.

### Thèmes

`src/core/theme.ts`. Un thème = un jeu de tokens, injecté en variables CSS
des deux côtés (site **et** admin). Presets livrés : `default`, `mg-perfume`.
Contrainte inscrite : MG Perfume garde **son** design, pas celui d'Atelier.

### Le reste

- `POST /api/deploy-hook` — reconstruit un site à l'enregistrement. Double
  verrou : session superadmin/propriétaire **et** secret comparé **à temps
  constant** (une comparaison `===` fuit le secret par mesure du temps).
- `GET /api/content/[tenant]` — contenu public filtré par modules actifs,
  `s-maxage=60, stale-while-revalidate=300`.
- `scripts/bootstrap.mjs` — crée le premier superadmin et le tenant.
  Délègue le hachage à Better Auth plutôt que de le réimplémenter : une
  implémentation divergente produirait un mot de passe que l'authent refuse
  ensuite, sans raison visible.
- `src/db/test_rls.sql` — simule deux applications, deux tenants, 8 contrôles.

---

## 4. Ce qui manque

Classé par gravité réelle, pas par effort.

### 4.1 `rls.sql` n'est appliqué par aucun chemin automatisé — 🔴

**[VÉRIFIÉ]** `DEPLOY.md` documente trois étapes manuelles : `0001_auth.sql`,
le schéma Drizzle, puis `rls.sql`. Mais `npm run db:migrate` ne génère et
n'applique que les migrations Drizzle. **`rls.sql` vit dans `src/db/`, pas
dans `src/db/migrations/`.**

Conséquence : une installation qui suit le chemin « plus simple »documenté
dans DEPLOY.md — poser les variables et lancer `npm run db:migrate` —
construit un schéma **sans aucune RLS**. Douze tables ouvertes, en
multi-tenant, sans le moindre avertissement.

C'est exactement le défaut que Continental a déjà subi : policies écrites,
`relrowsecurity = false`, et un test qui annonçait 20/20 parce que les
tables étaient vides.

**Correctif :** déplacer `rls.sql` dans le pipeline de migrations, ou l'y
référencer explicitement, et faire échouer le démarrage si
`app_current_tenant` n'existe pas en base.

### 4.2 Aucun garde-fou non-régression — 🟠

**[VÉRIFIÉ]** `rls.sql` couvre 14 tables. Rien ne vérifie qu'une **15e**
table, ajoutée plus tard, recevra bien RLS. Continental a ce garde-fou
(`008_fix_rls.sql` échoue si une table publique a `relrowsecurity = false`) ;
`atelier-admin` non.

**Correctif :** un `DO $$ … RAISE EXCEPTION $$` en fin de `rls.sql` qui
liste les tables de `information_schema.tables` sans RLS forcé.

### 4.3 Les modules existent, les écrans n'existent pas — 🟠

**[VÉRIFIÉ]** Routes admin réelles : `/admin/[slug]`, `/products`,
`/products/nouveau`, `/products/[id]`, `/settings`.

Le registre déclare 11 modules. Cinq ont un écran. Les autres — catégories,
bannières, pages, FAQ, leads, médias, blog, statistiques, paiements — sont
des permissions et des tables, pas des interfaces. Le module `payments`
n'a même pas de table.

Tant que `adminRoutes` est vide pour un module, il n'est pas « activable » en
toute honesty : l'activer affiche un écran vide.

### 4.4 Pas de résolution par domaine sur le site public — 🟠

**[VÉRIFIÉ]** `app_resolve_tenant_by_host()` existe. Mais le site client est
un déploiement Next.js **par tenant**, avec son propre domaine en variable
d'environnement. La table `tenant_domains` est donc aujourd'hui décorative :
un site déployé sur le mauvais domaine afficherait le mauvais contenu sans
avertissement.

**Correctif :** soit un vrai multisite (middleware qui résout l'hôte), soit
une vérification au démarrage qui échoue si le domaine du tenant ne
correspond pas à l'hôte servi.

### 4.5 Le blog existe en table, pas en interface — 🟡

**[VÉRIFIÉ]** `blog_posts` est dans le schéma, dans la RLS et dans le
registre de modules. Reporté par décision du commanditaire. À garder en tête
pour la phase 3.

---

## 5. Le plan, par phases

Chaque phase a un **critère de sortie vérifiable**. Une phase sans critère de
sortie n'est pas finie.

### Phase 0 — Sécuriser la plateforme *( Bloquante )*

Rien d'autre ne commence avant.

1. Intégrer `rls.sql` au chemin de migration. [#4.1]
2. Ajouter le garde-fou non-régression. [#4.2]
3. Faire échouer le démarrage si la base n'est pas conforme : vérifier que
   `app_current_tenant` existe, que `atelier_app` ne possède aucune table et
   qu'elle est `NOBYPASSRLS`.
4. Porter `test_rls.sql` dans une exécution automatisée, avec **données
   réelles** — jamais sur une base vide.

> **Sortie :** une base neuve, migrée par la seule commande documentée,
> passe `test_rls.sql` sans intervention manuelle.

### Phase 1 — Vérifier l'isolation à l'échelle

1. Porter le jeu de tests Continental : interrogation réelle via HTTP, deux
   comptes réels, un par rôle.
2. Ajouter un contrôle explicite du **contournement** : tenter
   `app.current_tenant` sur une autre valeur, tenter un `tenantId` en
   paramètre de requête, tenter un rôle forcé par en-tête.
3. Tester la **régression de départ** : une requête qui oublie le tenant
   doit renvoyer zéro ligne, jamais une erreur qui passe pour un bug.

> **Sortie :** toute tentative documentée de fuite entre tenants échoue, et
> l'échec est observable (ligne affectée, pas un simple code HTTP).

### Phase 2 — Un premier client réel

1. Créer le tenant depuis `/superadmin`.
2. Attribuer un domaine, activer les modules nécessaires, choisir un thème.
3. Déployer un site client qui consomme `GET /api/content/[tenant]`.
4. Faire des tests en conditions réelles : modifier un produit en admin, vérifier que le site
   change sans redéploiement (mode `live`) puis avec (mode `build`).

> **Sortie :** un commerçant publie un produit sans intervention technique.

### Phase 3 — Étoffer les modules

Dans l'ordre de la demande réelle, pas de l'ambition :

1. **Leads** — c'est le module qui rapporte le plus vite : un commerçant veut
   ses demandes de contact.
2. **Médiathèque** — sans elle, chaque image passe par un échange direct.
3. **Bannières et pages** — les écrans d'accueil se font ensuite.
4. **FAQ**, puis **blog** (si la demande revient).
5. **Statistiques** — utiles, mais secondaires : le commerçant voit déjà ses
   commandes.

Chaque module ajouté suit la règle : entrée dans `modules.ts`, table avec
`tenant_id`, policies dans `rls.sql`, écran admin, contrôle dans
`test_rls.sql`. Pas de `if (slug === '…')` dispersé.

### Phase 4 — Décider du sort de Continental

Point de décision, à la fin de la phase 3, avec des données réelles.

- Si la plateforme est fiable : **migrer Continental** dessus. Le portail
  intégré devient inutile.
- Si elle ne l'est pas : **assumer deux systèmes** et le dire dans le
  README. Un choix explicite vaut mieux qu'une migration précipitée.

Quel que soit le choix, Continental doit rester en service pendant toute la
durée. Une migration sans plan de retour n'est pas une migration.

---

## 6. Décisions déjà prises

| Décision | Raison |
|---|---|
| Un dépôt par client, pas de fork | Un fork_divient jamais maintenable ; un tenant si. |
| RLS forcée, pas seulement activée | Le propriétaire doit être soumis, sinon la sécurité est un décor. |
| Fermeture par défaut | Une page vide est un bug ; une fuite entre clients est un procès. |
| Le journal est en ajout seul | Un journal modifiable ne vaut rien. |
| Fonctions de résolution étroite | Une fonction large devient un contournement. |
| Secret de déploiement à temps constant | Une comparaison `===` fuit le secret par mesure du temps. |
| Hachage délégué à Better Auth | Réimplémenter divergerait silencieusement de son format. |
| MG garde son design | Le client le connaît ; on ne lui impose pas le nôtre. |

---

## 7. Questions ouvertes

À trancher avant la phase 2. Aucune n'est bloquante pour la phase 0.

1. **Les sites client sont-ils un déploiement par tenant, ou un seul
   déploiement multisite ?** Cela décide si `tenant_domains` sert à quelque
   chose.
2. **Facturation ?** Le portail est-il facturé au client, ou fait-il partie
   du forfait du site ? Cela change la notion de « superadmin ».
3. **Qui peut créer un tenant ?**aujourd'hui le superadmin. Un membre de
   l'agence doit-il pouvoir en proposer un ?
4. **Mode par défaut.** `live` ou `build` pour un nouveau client ? Le choix
   dépend de l'hébergement, pas du contenu.
5. **Les repositories client restent-ils séparés ?** Si oui, `atelier-admin`
   ne publie que l'API ; si non, il faut un mécanisme de distribution.

---

## 8. Ce qu'il ne faut pas faire

- **Ne pas retirer `FORCE`.** C'est écrit en commentaire dans le fichier,
  et dans `AGENTS.md`, parce que quelqu'un l'a déjà envisagé.
- **Ne pas prendre le `tenantId` d'un paramètre, d'un body ou d'un
  en-tête.** Il vient de la session, résolue côté serveur.
- **Ne pas appeler `getDb()` sans `withTenant()`.** Le contexte doit être posé
  avant la première requête.
- **Ne pas tester la sécurité sur une base vide.** Un test qui passe sur zéro
  ligne ne prouve rien — c'est l'erreur qui a fait annoncer 20/20 à un
  projet réellement ouvert.
- **Ne pas dupliquer le back-office dans les dépôts clients.** C'est ce que
  la phase 4 doit éviter.
- **Ne pas séparer les commits de sécurité des commits de fonctionnalité.**
  Ils se relisent différemment.

---

*Écrit le 05-10-2026. À relire avant d'entamer la phase 0.*