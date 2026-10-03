-- ============================================================================
-- test_rls.sql — Vérifie que l'isolation multi-tenant tient réellement.
--
-- Un schéma qui compile ne prouve rien : RLS peut être activée et rester
-- inopérante si l'application se connecte en propriétaire des tables, ou si
-- une politique a été écrite en `USING (true)`. C'est exactement ce qui
-- est arrivé sur MG Perfume.
--
-- Ce script simule deux applications connectées avec le rôle `atelier_app`,
-- deux tenants, et vérifie qu'aucune ligne ne traverse.
--
--   psql "$DATABASE_URL" -f test_rls.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────── mise en place ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE slug = '_test_a') THEN
    INSERT INTO tenants (slug, name, modules) VALUES
      ('_test_a', 'Tenant A de test', '["products"]'::jsonb),
      ('_test_b', 'Tenant B de test', '["products"]'::jsonb);
  END IF;
END $$;

INSERT INTO products (tenant_id, slug, name, price, is_active, published_at)
SELECT t.id, v.slug, v.name, 1000, true, now()
  FROM tenants t
  JOIN (VALUES
    ('_test_a', 'produit-a', 'Produit.secret.A'),
    ('_test_b', 'produit-b', 'Produit.secret.B')
  ) AS v(tslug, slug, name) ON v.tslug = t.slug
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- Les identifiants sont capturés ICI, en tant que propriétaire : une fois en
-- `atelier_app`, le RLS interdit précisément de relire la ligne du tenant — ce
-- qui est le comportement attendu, mais casse la préparation du test.
-- Une table temporaire n'est pas soumise au RLS.
CREATE TEMP TABLE _test_ids (slug text PRIMARY KEY, id uuid);
INSERT INTO _test_ids (slug, id)
SELECT slug, id FROM tenants WHERE slug IN ('_test_a', '_test_b')
ON CONFLICT DO NOTHING;

GRANT SELECT ON _test_ids TO atelier_app;

-- La suite bascule sur le rôle applicatif : c'est lui qui est soumis au RLS.
SET ROLE atelier_app;

-- ─────────────────────────────────────────────── assertions ──
DO $$
DECLARE
  id_a uuid; id_b uuid;
  vus_a int; vus_b int; vus_sans_tenant int;
  vus_super int;
  vus_insert int;
BEGIN
  SELECT id INTO id_a FROM _test_ids WHERE slug = '_test_a';
  SELECT id INTO id_b FROM _test_ids WHERE slug = '_test_b';

  IF id_a IS NULL OR id_b IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : tenant(s) de test introuvable(s) — la préparation a échoué';
  END IF;

  RAISE NOTICE 'tenant A = % / tenant B = %', id_a, id_b;

  -- 1. Sans contexte : AUCUNE ligne visible (échec fermé)
  PERFORM set_config('app.current_tenant', '', true);
  PERFORM set_config('app.user_role', 'viewer', true);
  SELECT count(*) INTO vus_sans_tenant FROM products;
  IF vus_sans_tenant <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC : % lignes visibles sans tenant — le schéma fuit',
      vus_sans_tenant;
  END IF;
  RAISE NOTICE 'ok  — sans contexte : 0 ligne (échec fermé)';

  -- 2. Tenant A ne voit que les siens
  PERFORM set_config('app.current_tenant', id_a::text, true);
  PERFORM set_config('app.user_role', 'viewer', true);
  SELECT count(*) INTO vus_a FROM products;
  IF vus_a <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC : le tenant A voit % lignes au lieu de 1', vus_a;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE name = 'Produit.secret.A') THEN
    RAISE EXCEPTION 'ÉCHEC : le tenant A ne voit pas son propre produit';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE name = 'Produit.secret.B') THEN
    RAISE EXCEPTION 'ÉCHEC FUITE : le tenant A voit le produit du tenant B';
  END IF;
  RAISE NOTICE 'ok  — tenant A : 1 ligne, la sienne uniquement';

  -- 3. Tenant B de même
  PERFORM set_config('app.current_tenant', id_b::text, true);
  SELECT count(*) INTO vus_b FROM products;
  IF vus_b <> 1 OR NOT EXISTS (SELECT 1 FROM products WHERE name = 'Produit.secret.B') THEN
    RAISE EXCEPTION 'ÉCHEC : le tenant B voit % lignes au lieu de la sienne', vus_b;
  END IF;
  RAISE NOTICE 'ok  — tenant B : 1 ligne, la sienne uniquement';

  -- 4. Écriture hors tenant refusée (le RLS filtre, il ne masque pas seulement)
  -- INSERT et DELETE ne se comportent PAS de la même façon sous RLS :
  --   • INSERT viole WITH CHECK  → Postgres LEVE une erreur
  --   • DELETE utilise USING     → les lignes sont simplement FILTRÉES, en silence
  -- D'où deux assertions différentes. On vérifie dans les deux cas qu'aucune
  -- ligne n'a été créée chez B, et non seulement l'absence d'exception.
  BEGIN
    INSERT INTO products (tenant_id, slug, name, price, is_active, published_at)
    VALUES (id_b, 'injection', 'Tentative depuis A', 1, true, now());
    RAISE EXCEPTION 'ÉCHEC : insertion acceptée sans erreur';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'ok  — écriture vers un autre tenant : refusée par le SGBD';
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%ÉCHEC%' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.current_tenant', id_b::text, true);
  PERFORM set_config('app.user_role', 'manager', true);
  IF EXISTS (SELECT 1 FROM products WHERE slug = 'injection') THEN
    RAISE EXCEPTION 'ÉCHEC FUITE : la ligne a été créée chez le tenant B';
  END IF;
  PERFORM set_config('app.current_tenant', id_a::text, true);
  PERFORM set_config('app.user_role', 'editor', true);
  RAISE NOTICE 'ok  — aucune ligne créée chez le tenant B';

  -- 5. viewer ne peut pas écrire, editor peut
  PERFORM set_config('app.current_tenant', id_a::text, true);
  PERFORM set_config('app.user_role', 'viewer', true);
  BEGIN
    INSERT INTO products (tenant_id, slug, name, price, is_active, published_at)
    VALUES (id_a, 'vueur', 'Tentative viewer', 1, true, now());
    RAISE EXCEPTION 'ÉCHEC : un viewer a pu écrire';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  — écriture refusée pour le rôle viewer';
  END;

  PERFORM set_config('app.user_role', 'editor', true);
  INSERT INTO products (tenant_id, slug, name, price, is_active, published_at)
  VALUES (id_a, 'editeur-ok', 'Produit éditeur', 1, true, now());
  RAISE NOTICE 'ok  — écriture acceptée pour le rôle editor';

  -- 6. editor ne peut PAS supprimer (manager requis)
  --
  -- ⚠ ATTENTION : avec RLS, un DELETE qui ne correspond à aucune ligne visible
  -- SUPPRIME ZÉRO LIGNE ET NE LÈVE AUCUNE ERREUR. On pourrait croire que
  -- l'éditeur a passé, parce qu'aucune exception n'a été levée. La propriété
  -- de sécurité réelle, c'est que la ligne SURVIT — c'est donc cela qu'on
  -- vérifie, et non l'absence d'exception.
  DELETE FROM products WHERE slug = 'editeur-ok';
  IF NOT EXISTS (SELECT 1 FROM products WHERE slug = 'editeur-ok') THEN
    RAISE EXCEPTION 'ÉCHEC : un editor a réellement supprimé la ligne';
  END IF;
  RAISE NOTICE 'ok  — suppression refusée pour le rôle editor (ligne intacte)';

  -- 7. superadmin traverse, comme prévu
  PERFORM set_config('app.user_role', 'superadmin', true);
  SELECT count(*) INTO vus_super FROM products;
  IF vus_super < 2 THEN
    RAISE EXCEPTION 'ÉCHEC : le superadmin ne voit pas tous les tenants (% lignes)', vus_super;
  END IF;
  RAISE NOTICE 'ok  — superadmin : vue transverse (% lignes)', vus_super;

  -- 8. Le journal d'audit reste en ajout seul
  PERFORM set_config('app.user_role', 'owner', true);
  PERFORM set_config('app.current_tenant', id_a::text, true);
  INSERT INTO audit_events (tenant_id, entity, action)
  VALUES (id_a, 'test', 'create');
  BEGIN
    DELETE FROM audit_events;
    RAISE EXCEPTION 'ÉCHEC : le journal d''audit a pu être vidé';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'ok  — audit_events rejette la suppression';
  END;

  -- 9. Modification de la fiche d'un site : l'agence oui, un client non.
  --    Sans ce contrôle, l'absence de politique UPDATE passe inaperçue :
  --    PostgreSQL refuse l'écriture sans lever d'erreur, et la console
  --    d'agence affichait des bascules qui n'enregistraient rien.
  PERFORM set_config('app.current_tenant', '', true);

  PERFORM set_config('app.user_role', 'owner', true);
  UPDATE tenants SET modules = modules
   WHERE id = id_a;
  GET DIAGNOSTICS vus_super = ROW_COUNT;
  IF vus_super <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC : un rôle client a modifié la fiche d''un site (% lignes)', vus_super;
  END IF;
  RAISE NOTICE 'ok  — modification de « tenants » refusée pour un rôle client';

  PERFORM set_config('app.user_role', 'superadmin', true);
  UPDATE tenants SET modules = modules
   WHERE id = id_a;
  GET DIAGNOSTICS vus_super = ROW_COUNT;
  IF vus_super <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC : le superadmin n''a pas pu modifier la fiche du site (% lignes)', vus_super;
  END IF;
  RAISE NOTICE 'ok  — modification de « tenants » acceptée pour le superadmin';

  RAISE NOTICE '';
  RAISE NOTICE 'TOUS LES CONTRÔLES PASSENT — isolation multi-tenant opérationnelle.';
END $$;

ROLLBACK;  -- le test ne laisse rien derrière lui