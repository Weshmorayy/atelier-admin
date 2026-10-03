/**
 * modules.ts — Registre de modules.
 *
 * PRINCIPE : les TYPES de modules vivent ici, au temps de compilation (ils
 * conditionnent la navigation, les routes, les permissions, le schéma). seule
 * l'ACTIVATION vit en base (`tenants.modules`), ce qui permet à un
 * superadmin d'activer/désactiver un module sans redéploiement.
 *
 * Conséquence recherchée : « ce site n'a pas de blog » se règle dans une seule
 * ligne d'interface. Pas de `if (slug === 'x')` dispersé dans le code.
 */

export type ModuleKey =
  | 'settings'      // identité, contacts, réseaux, horaires, SEO
  | 'products'      // catalogue
  | 'categories'    // arborescence catalogue
  | 'banners'       // bannières et campagnes
  | 'pages'         // pages composites
  | 'faq'
  | 'blog'
  | 'leads'         // messages, commandes WhatsApp, devis
  | 'media'         // bibliothèque de médias
  | 'analytics'     // statistiques
  | 'payments'      // moyen de paiement en ligne

/** Permission au format `module:action`. Vérifiée côté serveur uniquement. */
export type Permission =
  | 'read' | 'create' | 'update' | 'delete' | 'publish'
  | 'manage-settings' | 'manage-users' | 'view-analytics'

export interface ModuleDef {
  key: ModuleKey
  /** Libellé affiché dans l'admin (français). */
  label: string
  description: string
  /** Nom d'icône lucide-react. */
  icon: string
  /** Tables SQL utilisées — sert à documenter l'impact d'une désactivation. */
  tables: string[]
  /** Permissions requises pour ce module. */
  permissions: Permission[]
  /** Routes du back-office. Absentes → le module n'a pas d'écran admin. */
  adminRoutes: string[]
  /**
   * Emplacements rendus côté site client. Le site ne rend un bloc que si le
   * slot demandé figure dans cette liste pour le tenant.
   */
  clientSlots: string[]
  /** Modules dont celui-ci dépend. */
  requires?: ModuleKey[]
  /** Regroupement dans la navigation. */
  group: 'contenu' | 'commerce' | 'technique'
}

export const MODULE_REGISTRY: ModuleDef[] = [
  {
    key: 'settings',
    label: 'Réglages du site',
    description: 'Identité, contacts, réseaux sociaux, horaires, SEO, mentions légales.',
    icon: 'Settings',
    tables: ['site_settings'],
    permissions: ['manage-settings'],
    adminRoutes: ['/admin/settings'],
    clientSlots: ['footer', 'contact-block'],
    group: 'technique',
  },
  {
    key: 'products',
    label: 'Produits',
    description: 'Catalogue, prix, stock, images, mises en avant.',
    icon: 'Package',
    tables: ['products', 'product_images'],
    permissions: ['read', 'create', 'update', 'delete', 'publish'],
    adminRoutes: ['/admin/products'],
    clientSlots: ['catalogue', 'product-grid', 'product-detail', 'featured'],
    requires: ['categories'],
    group: 'commerce',
  },
  {
    key: 'categories',
    label: 'Catégories',
    description: 'Familles de produits et arborescence du catalogue.',
    icon: 'FolderTree',
    tables: ['categories'],
    permissions: ['read', 'create', 'update', 'delete'],
    adminRoutes: ['/admin/categories'],
    clientSlots: ['catalogue-filter'],
    group: 'commerce',
  },
  {
    key: 'banners',
    label: 'Bannières',
    description: 'Visuels de campagne et accroches d\'accueil.',
    icon: 'Image',
    tables: ['banners'],
    permissions: ['read', 'create', 'update', 'delete', 'publish'],
    adminRoutes: ['/admin/banners'],
    clientSlots: ['hero', 'strip'],
    group: 'contenu',
  },
  {
    key: 'pages',
    label: 'Pages',
    description: 'Pages composites (à propos, CGU…) assemblées par blocs.',
    icon: 'LayoutTemplate',
    tables: ['pages'],
    permissions: ['read', 'create', 'update', 'delete', 'publish'],
    adminRoutes: ['/admin/pages'],
    clientSlots: ['page'],
    group: 'contenu',
  },
  {
    key: 'faq',
    label: 'FAQ',
    description: 'Questions fréquentes, injectées en JSON-LD pour le SEO.',
    icon: 'HelpCircle',
    tables: ['faqs'],
    permissions: ['read', 'create', 'update', 'delete'],
    adminRoutes: ['/admin/faq'],
    clientSlots: ['faq'],
    group: 'contenu',
  },
  {
    key: 'blog',
    label: 'Blog',
    description: 'Articles, catégories, publication programmée.',
    icon: 'Newspaper',
    tables: ['blog_posts'],
    permissions: ['read', 'create', 'update', 'delete', 'publish'],
    adminRoutes: ['/admin/blog'],
    clientSlots: ['blog-list', 'blog-post'],
    group: 'contenu',
  },
  {
    key: 'leads',
    label: 'Messages & commandes',
    description: 'Demandes de contact, commandes WhatsApp, devis.',
    icon: 'Inbox',
    tables: ['leads'],
    permissions: ['read', 'update'],
    adminRoutes: ['/admin/leads'],
    clientSlots: ['contact-form'],
    group: 'commerce',
  },
  {
    key: 'media',
    label: 'Médias',
    description: 'Bibliothèque d\'images téléversées vers le stockage objet.',
    icon: 'FolderOpen',
    tables: ['media'],
    permissions: ['read', 'create', 'update', 'delete'],
    adminRoutes: ['/admin/media'],
    clientSlots: [],
    group: 'technique',
  },
  {
    key: 'analytics',
    label: 'Statistiques',
    description: 'Trafic et événements de conversion (clics WhatsApp, commandes).',
    icon: 'BarChart3',
    tables: ['site_events'],
    permissions: ['view-analytics'],
    adminRoutes: ['/admin/analytics'],
    clientSlots: [],
    group: 'technique',
  },
  {
    key: 'payments',
    label: 'Paiements en ligne',
    description: 'Passerelle de paiement (PayTech Sénégal) et suivi des règlements.',
    icon: 'CreditCard',
    tables: ['leads'],
    permissions: ['read', 'create', 'update'],
    adminRoutes: ['/admin/payments'],
    clientSlots: ['checkout'],
    group: 'commerce',
  },
]

const REGISTRY_MAP = new Map(MODULE_REGISTRY.map((m) => [m.key, m]))

export function getModule(key: ModuleKey): ModuleDef {
  const m = REGISTRY_MAP.get(key)
  if (!m) throw new Error(`Module inconnu : ${key}`)
  return m
}

export function allModules(): ModuleDef[] { return MODULE_REGISTRY }

/**
 * Modules activés à la création d'un tenant : AUCUN.
 *
 * Décision assumée : le choix appartient à l'agence, pas au système.
 * Un module activé par défaut sur un site qui n'en a pas besoin produit un
 * écran vide à maintenir ; à l'inverse, oublier d'en cocher un se voit
 * immédiatement. La liste part donc vide et se coche dans la console
 * superadmin.
 */
export function defaultModuleKeys(): ModuleKey[] {
  return []
}

/** Modules actifs d'un tenant, dépendances comprises. */
export function resolveEnabled(keys: unknown): ModuleKey[] {
  const raw = Array.isArray(keys) ? (keys.filter((k) => typeof k === 'string') as ModuleKey[]) : []
  const set = new Set<ModuleKey>(raw.filter((k) => REGISTRY_MAP.has(k)))

  // Ajoute les dépendances manquantes — un module ne peut pas être actif si sa
  // dépendance ne l'est pas.
  let changed = true
  while (changed) {
    changed = false
    for (const key of [...set]) {
      for (const dep of getModule(key).requires ?? []) {
        if (!set.has(dep)) { set.add(dep); changed = true }
      }
    }
  }
  return [...set]
}

export function isModuleEnabled(enabled: ModuleKey[], key: ModuleKey): boolean {
  return enabled.includes(key)
}

/** Un module et toutes ses dépendances sont-ils actifs ? */
export function canUse(enabled: ModuleKey[], key: ModuleKey): boolean {
  const set = new Set(enabled)
  const dep = getModule(key).requires ?? []
  return set.has(key) && dep.every((d) => set.has(d))
}

export function permissionAllowed(
  enabled: ModuleKey[],
  key: ModuleKey,
  perm: Permission,
): boolean {
  if (!canUse(enabled, key)) return false
  return getModule(key).permissions.includes(perm)
}

/**
 * Ce que le RÔLE autorise, indépendamment du module.
 *
 * `permissionAllowed` répond à « ce module est-il actif et déclare-t-il cette
 * permission ? ». Il ne dit rien du rôle : sans ce complément, un `editor`
 * voyait le bouton Supprimer alors que le SGBD refuse toujours l'action.
 * L'utilisateur ne doit pas se voir proposer ce qu'il ne pourra pas faire.
 *
 * L'ordre suit l'échelle de `app_role_at_least` (rls.sql), pas l'ordre
 * alphabétique des chaînes.
 */
export function roleAllows(role: string, perm: Permission): boolean {
  switch (role) {
    case 'superadmin':
    case 'owner':
      return true
    case 'manager':
      return perm !== 'manage-users'
    case 'editor':
      return perm === 'read' || perm === 'create' || perm === 'update' || perm === 'publish'
    case 'viewer':
      return perm === 'read'
    default:
      return false          // rôle inconnu : aucune permission, jamais d'escalade
  }
}

/** Navigation admin filtrée par modules actifs, groupée. */
export function buildNav(enabled: ModuleKey[]) {
  const groups: Record<ModuleDef['group'], ModuleDef[]> = {
    contenu: [], commerce: [], technique: [],
  }
  for (const m of MODULE_REGISTRY) {
    if (enabled.includes(m.key) && m.adminRoutes.length > 0) groups[m.group].push(m)
  }
  return groups
}