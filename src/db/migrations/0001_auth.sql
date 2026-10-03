-- ============================================================================
-- 0001_auth.sql — Tables Better Auth (user, session, account, verification)
--                  + plugins organization et admin.
--
-- VERSIONNÉ ET APPLIQUÉ PAR SCRIPT (drizzle-kit migrate), jamais à la main.
-- C'est exactement la dette qui a produit l'incident `is_hero` sur MG Perfume
-- (schéma réappliqué à la main, code et base divergents).
--
-- Rôle : propriétaire des tables (MIGRATION_DATABASE_URL).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "user" (
  "id"            text PRIMARY KEY,
  "name"          text,
  "email"         text NOT NULL,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image"         text,
  "created_at"    timestamp NOT NULL DEFAULT now(),
  "updated_at"    timestamp NOT NULL DEFAULT now(),
  -- plugin admin
  "role"          text,
  "banned"        boolean NOT NULL DEFAULT false,
  "ban_reason"    text,
  "ban_expires"   timestamp,
  -- Atelier : accès transverse à tous les tenants
  "is_super_admin" boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_idx" ON "user" ("email");

CREATE TABLE IF NOT EXISTS "session" (
  "id"          text PRIMARY KEY,
  "expires_at"  timestamp NOT NULL,
  "token"       text NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now(),
  "ip_address"  text,
  "user_agent"  text,
  "user_id"     text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- plugin admin : sous-session d'impersonation
  "impersonated_by" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_idx" ON "session" ("token");
CREATE INDEX IF NOT EXISTS "session_user_idx" ON "session" ("user_id");

CREATE TABLE IF NOT EXISTS "account" (
  "id"                       text PRIMARY KEY,
  "account_id"               text NOT NULL,
  "provider_id"              text NOT NULL,
  "user_id"                  text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token"             text,
  "refresh_token"            text,
  "id_token"                 text,
  "access_token_expires_at"  timestamp,
  "refresh_token_expires_at" timestamp,
  "scope"                    text,
  -- HASH du mot de passe, jamais le mot de passe en clair
  "password"                 text,
  "created_at"               timestamp NOT NULL DEFAULT now(),
  "updated_at"               timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "account_user_idx" ON "account" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_idx"
  ON "account" ("provider_id", "account_id");

CREATE TABLE IF NOT EXISTS "verification" (
  "id"         text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value"      text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- ───────────────────────────────────────────────── plugin organization ──
-- Une organisation = un site client.

CREATE TABLE IF NOT EXISTS "organization" (
  "id"           text PRIMARY KEY,
  "name"         text NOT NULL,
  "slug"         text NOT NULL,
  "logo"         text,
  "metadata"     jsonb,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "member_limit" integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_idx" ON "organization" ("slug");

CREATE TABLE IF NOT EXISTS "member" (
  "id"              text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id"         text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role"            text NOT NULL DEFAULT 'owner',
  "created_at"      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "member_org_user_idx"
  ON "member" ("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "member_user_idx" ON "member" ("user_id");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id"              text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "email"           text NOT NULL,
  "role"            text,
  "status"          text NOT NULL DEFAULT 'pending',
  "expires_at"      timestamp NOT NULL,
  "inviter_id"      text NOT NULL REFERENCES "user"("id")
);
CREATE INDEX IF NOT EXISTS "invitation_org_idx" ON "invitation" ("organization_id");

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠ AUCUNE Row Level Security sur ces tables.
--
-- Elles ne portent pas de tenant_id : ce sont les comptes de l'agence et des
-- commerçants, pas du contenu client. Le rattachement d'un utilisateur à un
-- site passe par member.organizationId, et les politiques RLS du contenu
-- (`rls.sql`) s'appuient sur le tenant déjà résolu en amont.
-- ═════════════════════════════════════════════════════════════════════════