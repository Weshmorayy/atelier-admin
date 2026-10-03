/**
 * auth-schema.ts — Tables Better Auth (user, session, account, verification)
 * et des plugins `organization` + `admin`.
 *
 * Écrites à la main plutôt que générées : la CLI Better Auth introspecte une
 * base vivante, indisponible à la construction. Les noms de champs et de
 * modèles correspondent exactement à ce que l'adaptateur Drizzle attend
 * (camelCase, clés `user`, `session`, `account`, `verification`,
 * `organization`, `member`, `invitation`).
 *
 * ⚠ Ces tables ne portent PAS de `tenant_id` : ce sont les comptes de
 *   l'agence et des commerçants, pas du contenu client. Le rattachement d'un
 *   utilisateur à un site se fait via `member.organizationId`.
 */

import {
  pgTable, text, boolean, integer, timestamp, jsonb,
  primaryKey, uniqueIndex, index,
} from 'drizzle-orm/pg-core'

/* ─────────────────────────────────────────────────────────────── noyau ── */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),

  /* plugin admin */
  role: text('role'),
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),

  /* champ additionnel Atelier : accès transverse à tous les tenants */
  isSuperAdmin: boolean('is_super_admin').notNull().default(false),
}, (t) => ({
  emailIdx: uniqueIndex('user_email_idx').on(t.email),
}))

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /* plugin admin : sous-session d'impersonation */
  impersonatedBy: text('impersonated_by'),
  /* plugin organization : tenant actif. C'est ce champ qui relie une session
     à un site ; sans lui, Better Auth signale un écart de schéma au démarrage. */
  activeOrganizationId: text('active_organization_id'),
}, (t) => ({
  tokenIdx: uniqueIndex('session_token_idx').on(t.token),
  userIdx:   index('session_user_idx').on(t.userId),
}))

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  /** Hash du mot de passe — jamais le mot de passe en clair. */
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  userIdx: index('account_user_idx').on(t.userId),
  providerIdx: uniqueIndex('account_provider_idx').on(t.providerId, t.accountId),
}))

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  identifierIdx: index('verification_identifier_idx').on(t.identifier),
}))

/* ───────────────────────────────────────────────── plugin organization ── */

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** 1 : un utilisateur = un site client. 0 : illimité. */
  memberLimit: integer('member_limit').notNull().default(1),
}, (t) => ({
  slugIdx: uniqueIndex('organization_slug_idx').on(t.slug),
}))

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** 'owner' | 'admin' | 'editor' | 'viewer' */
  role: text('role').notNull().default('owner'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  orgUserIdx: uniqueIndex('member_org_user_idx').on(t.organizationId, t.userId),
  userIdx:    index('member_user_idx').on(t.userId),
}))

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at').notNull(),
  inviterId: text('inviter_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('invitation_org_idx').on(t.organizationId),
}))

/** Export groupé — l'adaptateur Drizzle reçoit cet objet. */
export const authSchema = {
  user,
  session,
  account,
  verification,
  organization,
  member,
  invitation,
}

export type AuthUser = typeof user.$inferSelect
export type AuthMember = typeof member.$inferSelect
export type AuthOrganization = typeof organization.$inferSelect