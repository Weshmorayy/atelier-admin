# Déploiement — par où commencer

Réponse courte : **vous ne pouvez pas encore y accéder.** Le portail est du code
dans un dépôt, il ne tourne nulle part. Voici l'ordre exact pour y arriver.

---

## Ce que vous devez faire, étape par étape

### 0. D'abord : le mot de passe MG (5 min, urgent)

Le mot de passe administrateur de MG Perfume est **écrit en clair dans un dépôt
public** (`admin` / `MG@D4k4r-Parfum!2026`). Supprimer la ligne ne sert à rien,
il reste dans l'historique Git.

À faire : **demander au client de le changer**, et de vérifier s'il a été
réutilisé ailleurs. Ne fais pas ce travail en'attendant le reste.

---

### 1. Créer la base de données (Coolify)

Dans Coolify, sur le même VPS que vos sites :

- **New Resource → PostgreSQL**
- Nom : `atelier`
- Retenez le mot de passe

Une fois déployée, deux chaînes de connexion sont affichées :
- `postgresql://postgres:MOT_DE_PASSE@host:5432/atelier` → **propriétaire**
- `postgresql://atelier_app:...@host:5432/atelier` → **rôle applicatif**

---

### 2. Créer le rôle applicatif

Il ne doit **pas** être propriétaire des tables : sinon `FORCE ROW LEVEL
SECURITY` ne protège rien (PostgreSQL fait confiance au propriétaire).

Dans le client SQL de Coolify, sur la base `atelier` :

```sql
CREATE ROLE atelier_app LOGIN PASSWORD 'un-mot-de-passe-différent';
GRANT ALL ON SCHEMA public TO atelier_app;
```

Le script `rls.sql`-Termine ensuite `atelier_app` (il a déjà été écrit pour
ça). Vous pouvez donc l'exécuter tel quel.

---

### 3. Déployer le portail

- **New Resource → Application/Docker**, dépôt `Weshmorayy/atelier-admin`
- Variables d'environnement :

```
DATABASE_URL=postgresql://atelier_app:...@postgres:5432/atelier
MIGRATION_DATABASE_URL=postgresql://postgres:...@postgres:5432/atelier
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=https://admin.votredomaine.sn
NEXT_PUBLIC_APP_URL=https://admin.votredomaine.sn
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=atelier-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://media.votredomaine.sn
S3_FORCE_PATH_STYLE=true
```

- **Générer `BETTER_AUTH_SECRET`** : `openssl rand -base64 32`
  (ou `head -c 32 /dev/urandom | base64`)

---

### 4. Appliquer le schéma

Dans le client SQL de Coolify, **dans cet ordre** :

1. `src/db/migrations/0001_auth.sql` — tables Better Auth
2. `src/db/schema.sql` généré — tables métier (voir ci-dessous)
3. `src/db/rls.sql` — isolation

> **À noter :** le schéma métier est écrit avec Drizzle. Pour l'obtenir :
> ```bash
> MIGRATION_DATABASE_URL=postgresql://postgres:...@atelier \
>   npm run db:generate
> ```
> Cela écrit `drizzle/0000_*.sql`, à exécuter en étape 2.

Ou, plus simple, une fois les variables posées :

```bash
MIGRATION_DATABASE_URL=postgresql://postgres:...@atelier npm run db:migrate
```

---

### 5. Créer votre compte et le tenant (une commande)

```bash
export DATABASE_URL=postgresql://atelier_app:...@atelier
export BOOTSTRAP_EMAIL=vous@votredomaine.sn
export BOOTSTRAP_PASSWORD='un-mot-de-passe- long et aléatoire '
node scripts/bootstrap.mjs
```

Crée votre compte superadmin et le tenant Continental. **Aucun module n'est
activé** — c'est vous qui cochez ce que vous voulez dans la console.

---

### 6. Charger le catalogue Continental

```bash
node scripts/seed-continental.mjs > seed.sql
```

Puis exécutez `seed.sql` dans le client SQL. Il ajoute 6 produits, 3 catégories.

---

### 7. Vérifier que l'isolation fonctionne

```bash
psql "$DATABASE_URL" -f src/db/test_rls.sql
```

Attendu : 8 contrôles « ok », puis `TOUS LES CONTRÔLES PASSENT`.

**Si ce test échoue, ne continuez pas** — cela signifie que l'isolation
multi-tenant ne tient pas, et les sites clients pourraient voir le contenu
les uns des autres.

---

### 8. Vous connecter

- `https://admin.votredomaine.sn/superadmin` → voir tous les sites, cocher les modules
- `https://admin.votredomaine.sn/admin/continental` → gérer le site

---

## Ce qu'il reste à ma charge

- Brancher le rebuild automatique de Continental
- Les modules restants : bannières, FAQ, messages, blog
- La documentation de l'admin pour vos clients
- La migration MG (déjà extractible en lecture seule : 116 produits relevés)

## Ce que vous devez décider

1. **Domaine de l'admin** : `admin.votredomaine.sn` ?
2. **Qui a accès** : vous seul, ou un compte par client ?
3. **Première étape MG** : changer le mot de passe d'abord, ou déployer d'abord ?

---

## Réponse aux remarques faites

**« C'est moche et bizarre »** — l'admin utilisait les polices système et très
peu de style. Refait avec une vraie identité (Instrument Serif en display,
Instrument Sans pour l'interface), des champs/boutons/puces redessinés.
À voir une fois déployé pour juger.

**« Un tenant n'active que ceux dont il a besoin, c'est faux »** — vous avez
raison. Le système activait 4 modules par défaut. C'est supprimé : un tenant
démarre **vide**, et vous cochez ce que vous voulez dans `/superadmin`.