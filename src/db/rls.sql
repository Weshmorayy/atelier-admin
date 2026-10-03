-- ============================================================================
-- rls.sql — Isolation multi-tenant (Row Level Security)
-- ============================================================================
-- À appliquer APRÈS le schéma, avec le rôle PROPRIÉTAIRE des tables.
-- En production, l'application ne doit PAS se connecter avec ce rôle : elle
-- utilise `atelier_app`, qui ne possède rien.
--
-- RÈGLE CRITIQUE — `FORCE ROW LEVEL SECURITY` est indispensable.
-- Sans lui, PostgreSQL fait confiance au propriétaire de la table et SAUTE
-- complètement les politiques. C'est l'erreur qui fait croire à un
-- multi-tenant sécurisé alors qu'il ne l'est pas du tout.
--
-- Le schéma échoue toujours « fermé » : si `app.current_tenant` n'est pas
-- positionnée dans la transaction, aucune ligne n'est visible. C'est le
-- comportement voulu — mieux vaut une page vide qu'une fuite entre clients.
-- ============================================================================


-- ─────────────────────────────────────────────────────── rôles applicatifs ---
-- Le rôle utilisé par l'application. NE POSSÈDE AUCUNE TABLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atelier_app') THEN
    CREATE ROLE atelier_app NOLOGIN;
  END IF;
END $$;


-- ─────────────────────────────────────────────────────── fonctions d'aide ---

-- Tenant courant. `true` = second argument : absent → NULL → aucune ligne.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.user_role', true), ''), 'viewer');
$$;

CREATE OR REPLACE FUNCTION app_is_superadmin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_current_role() = 'superadmin';
$$;

-- Un rôle a-t-il au moins le niveau requis ? (ordre : viewer < editor <
-- manager < owner). `superadmin` passe tout.
CREATE OR REPLACE FUNCTION app_role_at_least(required text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT app_is_superadmin()
      OR CASE app_current_role()
           WHEN 'owner'   THEN required IN ('viewer','editor','manager','owner')
           WHEN 'manager' THEN required IN ('viewer','editor','manager')
           WHEN 'editor'  THEN required IN ('viewer','editor')
           ELSE required = 'viewer'
         END;
$$;


-- ─────────────────────────────────────────────────────── politiques tables ---

-- `tenants` : un tenant ne se voit que lui-même.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON tenants;
CREATE POLICY tenant_self ON tenants
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR id = app_current_tenant());

-- `tenant_domains`
ALTER TABLE tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domains FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_domains_sel ON tenant_domains;
CREATE POLICY tenant_domains_sel ON tenant_domains
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR tenant_id = app_current_tenant());
DROP POLICY IF EXISTS tenant_domains_wri ON tenant_domains;
CREATE POLICY tenant_domains_wri ON tenant_domains
  FOR ALL TO atelier_app
  USING (app_is_superadmin() OR tenant_id = app_current_tenant())
  WITH CHECK (app_is_superadmin() OR tenant_id = app_current_tenant());


-- ── Contenu éditorial : lecture editor, écriture editor, suppression manager ──
-- products · categories · banners · pages · faqs · blog_posts · product_images · media

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','products','product_images','banners','pages','faqs',
    'blog_posts','media'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE : le propriétaire est aussi soumis
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS sel ON %I', t);
    EXECUTE format($f$
      CREATE POLICY sel ON %I FOR SELECT TO atelier_app
      USING (app_is_superadmin() OR tenant_id = app_current_tenant())
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS ins ON %I', t);
    EXECUTE format($f$
      CREATE POLICY ins ON %I FOR INSERT TO atelier_app
      WITH CHECK (
        app_is_superadmin()
        OR (tenant_id = app_current_tenant() AND app_role_at_least('editor'))
      )
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS upd ON %I', t);
    EXECUTE format($f$
      CREATE POLICY upd ON %I FOR UPDATE TO atelier_app
      USING (
        app_is_superadmin()
        OR (tenant_id = app_current_tenant() AND app_role_at_least('editor'))
      )
      WITH CHECK (
        app_is_superadmin()
        OR (tenant_id = app_current_tenant() AND app_role_at_least('editor'))
      )
    $f$, t);

    -- Suppression réservée au manager : protects la masse des contenus.
    EXECUTE format('DROP POLICY IF EXISTS del ON %I', t);
    EXECUTE format($f$
      CREATE POLICY del ON %I FOR DELETE TO atelier_app
      USING (
        app_is_superadmin()
        OR (tenant_id = app_current_tenant() AND app_role_at_least('manager'))
      )
    $f$, t);
  END LOOP;
END $$;


-- ── Réglages du site : écriture réservée au owner ──────────────────────────
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_settings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS settings_sel ON site_settings;
CREATE POLICY settings_sel ON site_settings
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR tenant_id = app_current_tenant());
DROP POLICY IF EXISTS settings_wri ON site_settings;
CREATE POLICY settings_wri ON site_settings
  FOR ALL TO atelier_app
  USING      (app_is_superadmin() OR (tenant_id = app_current_tenant() AND app_role_at_least('owner')))
  WITH CHECK  (app_is_superadmin() OR (tenant_id = app_current_tenant() AND app_role_at_least('owner')));


-- ── Leads : append-only pour editor, gestion pour manager ───────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_sel ON leads;
CREATE POLICY leads_sel ON leads
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR tenant_id = app_current_tenant());
DROP POLICY IF EXISTS leads_ins ON leads;
CREATE POLICY leads_ins ON leads
  FOR INSERT TO atelier_app
  WITH CHECK (tenant_id = app_current_tenant());
DROP POLICY IF EXISTS leads_upd ON leads;
CREATE POLICY leads_upd ON leads
  FOR UPDATE TO atelier_app
  USING (app_is_superadmin() OR (tenant_id = app_current_tenant() AND app_role_at_least('manager')));


-- ── Journal d'audit : insertion libre, aucune modification ─────────────────
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_sel ON audit_events;
CREATE POLICY audit_sel ON audit_events
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR (tenant_id = app_current_tenant() AND app_role_at_least('manager')));
DROP POLICY IF EXISTS audit_ins ON audit_events;
CREATE POLICY audit_ins ON audit_events
  FOR INSERT TO atelier_app
  WITH CHECK (tenant_id = app_current_tenant());

-- Aucun UPDATE ni DELETE : le journal est en ajout seul. Les politiques
-- d'interdiction ci-dessous font échouer l'opération si quelqu'un essaie.
DROP POLICY IF EXISTS audit_upd ON audit_events;
CREATE POLICY audit_upd ON audit_events
  FOR UPDATE TO atelier_app USING (false);
DROP POLICY IF EXISTS audit_del ON audit_events;
CREATE POLICY audit_del ON audit_events
  FOR DELETE TO atelier_app USING (false);


-- ── Événements de stats : insertion publique (site client), lecture manager ──
ALTER TABLE site_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_ins ON site_events;
CREATE POLICY events_ins ON site_events
  FOR INSERT TO atelier_app WITH CHECK (tenant_id = app_current_tenant());
DROP POLICY IF EXISTS events_sel ON site_events;
CREATE POLICY events_sel ON site_events
  FOR SELECT TO atelier_app
  USING (app_is_superadmin() OR (tenant_id = app_current_tenant() AND app_role_at_least('viewer')));


-- ═══════════════════════════════════════════════════════ immuabilité audit ===
-- Empêche la troncature et la suppression en cascade, même par un bug applicatif.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events est en ajout seul (tentative % sur %)', TG_OP, TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS audit_events_no_mutate ON audit_events;
CREATE TRIGGER audit_events_no_mutate
  BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();


-- ═══════════════════════════════════════════════════════ grants applicatifs ==
GRANT USAGE ON SCHEMA public TO atelier_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  tenants, tenant_domains, categories, products, product_images, banners,
  pages, faqs, blog_posts, site_settings, leads, media, audit_events, site_events
  TO atelier_app;

-- Séquences : inutiles (UUID), mais évite toute erreur future.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO atelier_app;

-- Le rôle applicatif ne doit jamais pouvoir neutraliser la sécurité.
ALTER ROLE atelier_app NOBYPASSRLS;
-- ═════════════════════════════════════════════════════════════════════════
-- RÉSOLUTION DU TENANT — le problème de démarrage
-- ═════════════════════════════════════════════════════════════════════════
-- Pour poser `app.current_tenant`, il faut connaître le tenant. Mais la table
-- `tenants` est elle-même protégée par RLS, qui exige justement ce contexte.
-- Sans issue, l'application ne trouve jamais son tenant et renvoie 404 partout.
--
-- Solution : une fonction SECURITY DEFINER, c'est-à-dire exécutée avec les
-- droits du propriétaire. Elle ne retourne QUE la correspondance slug → id,
-- et rien de plus : elle n'expose aucun contenu, aucun réglage, aucun secret.
-- Le RLS du contenu s'applique ensuite normalement.
--
-- ⚠ Fonction volontairement étroite : pas de SELECT générique, pas de
--   passage de colonne en paramètre. Une fonction large de ce type
--   ('resolver(text, text)') deviendrait un contournement du RLS.

CREATE OR REPLACE FUNCTION app_resolve_tenant(p_slug text)
RETURNS TABLE (id uuid, slug text, name text, locale text, modules jsonb, theme jsonb)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name, t.locale, t.modules, t.theme
    FROM tenants t
   WHERE t.slug = p_slug AND t.status = 'active'
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_resolve_tenant_by_host(p_host text)
RETURNS TABLE (id uuid, slug text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.slug
    FROM tenant_domains td
    JOIN tenants t ON t.id = td.tenant_id
   WHERE lower(td.domain) = lower(split_part(p_host, ':', 1))
     AND t.status = 'active'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_resolve_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_tenant_by_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_tenant(text) TO atelier_app;
GRANT EXECUTE ON FUNCTION app_resolve_tenant_by_host(text) TO atelier_app;
