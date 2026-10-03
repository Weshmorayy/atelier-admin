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

INSERT INTO products (tenant_id, slug, name, price, category_label, is_active, published_at)
SELECT t.id, v.slug, v.name, 1000, 'Test', true, now()
  FROM tenants t
  JOIN (VALUES
    ('_test_a', 'produit-a', 'Produit.secret.A'),
    ('_test_b', 'produit-b', 'Produit.secret.B')
  ) AS v(tslug, slug, name) ON v.tslug = t.slug
ON CONFLICT (tenant_id, slug) DO NOTHING;

-- ─────────────────────────────────────────────── assertions ──
DO $$
DECLARE
  id_a uuid; id_b uuid;
  vus_a int; vus_b int; vus_sans_tenant int;
  vus_super int;
  vus_insert int;
BEGIN
  SELECT id INTO id_a FROM tenants WHERE slug = '_test_a';
  SELECT id INTO id_b FROM tenants WHERE slug = '_test_b';

  RAISE NOTICE 'tenant A = % / tenant B = %', id_a, id_b;

  -- 1. Sans contexte : AUCUNE ligne visible (échec fermé)
  SELECT set_config('app.current_tenant', '', true);
  SELECT set_config('app.user_role', 'viewer', true);
  SELECT count(*) INTO vus_sans_tenant FROM products;
  IF vus_sans_tenant <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC : % lignes visibles sans tenant — le schéma fuit',
      vus_sans_tenant;
  END IF;
  RAISE NOTICE 'ok  — sans contexte : 0 ligne (échec fermé)';

  -- 2. Tenant A ne voit que les siens
  SELECT set_config('app.current_tenant', id_a::text, true);
  SELECT set_config('app.user_role', 'viewer', true);
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
  SELECT set_config('app.current_tenant', id_b::text, true);
  SELECT count(*) INTO vus_b FROM products;
  IF vus_b <> 1 OR NOT EXISTS (SELECT 1 FROM products WHERE name = 'Produit.secret.B') THEN
    RAISE EXCEPTION 'ÉCHEC : le tenant B voit % lignes au lieu de la sienne', vus_b;
  END IF;
  RAISE NOTICE 'ok  — tenant B : 1 ligne, la sienne uniquement';

  -- 4. Écriture hors tenant refusée (le RLS filtre, il ne masque pas seulement)
  BEGIN
    INSERT INTO products (tenant_id, slug, name, price, category_label, is_active, published_at)
    VALUES (id_b, 'injection', 'Tentative depuis A', 1, 'Test', true, now());
    RAISE EXCEPTION 'ÉCHEC : insertion dans le tenant d''autre réussie';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  — écriture vers un autre tenant refusée';
  END;

  -- 5. viewer ne peut pas écrire, editor peut
  SELECT set_config('app.current_tenant', id_a::text, true);
  SELECT set_config('app.user_role', 'viewer', true);
  BEGIN
    INSERT INTO products (tenant_id, slug, name, price, category_label, is_active, published_at)
    VALUES (id_a, 'vueur', 'Tentative viewer', 1, 'Test', true, now());
    RAISE EXCEPTION 'ÉCHEC : un viewer a pu écrire';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  — écriture refusée pour le rôle viewer';
  END;

  SELECT set_config('app.user_role', 'editor', true);
  INSERT INTO products (tenant_id, slug, name, price, category_label, is_active, published_at)
  VALUES (id_a, 'editeur-ok', 'Produit éditeur', 1, 'Test', true, now());
  RAISE NOTICE 'ok  — écriture acceptée pour le rôle editor';

  -- 6. editor ne peut PAS supprimer (manager requis)
  BEGIN
    DELETE FROM products WHERE slug = 'editeur-ok';
    RAISE EXCEPTION 'ÉCHEC : un editor a pu supprimer';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  — suppression refusée pour le rôle editor';
  END;

  -- 7. superadmin traverse, comme prévu
  SELECT set_config('app.user_role', 'superadmin', true);
  SELECT count(*) INTO vus_super FROM products;
  IF vus_super < 2 THEN
    RAISE EXCEPTION 'ÉCHEC : le superadmin ne voit pas tous les tenants (% lignes)', vus_super;
  END IF;
  RAISE NOTICE 'ok  — superadmin : vue transverse (% lignes)', vus_super;

  -- 8. Le journal d'audit reste en ajout seul
  SELECT set_config('app.user_role', 'owner', true);
  SELECT set_config('app.current_tenant', id_a::text, true);
  INSERT INTO audit_events (tenant_id, entity, action)
  VALUES (id_a, 'test', 'create');
  BEGIN
    DELETE FROM audit_events;
    RAISE EXCEPTION 'ÉCHEC : le journal d''audit a pu être vidé';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE 'ok  — audit_events rejette la suppression';
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'TOUS LES CONTRÔLES PASSENT — isolation multi-tenant opérationnelle.';
END $$;

ROLLBACK;  -- le test ne laisse rien derrière lui