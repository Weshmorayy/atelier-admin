/**
 * theme.ts — Identité visuelle par tenant, pour le SITE et pour l'ADMIN.
 *
 * Contrainte explicite : le client MG Perfume connaît déjà son back-office.
 * Son design est donc conservé tel quel, comme un thème versionné — pas
 * replaced par un nouveau design « maison ».
 *
 * Un thème = un jeu de tokens. Il produit des variables CSS, injectées
 * identically côté admin et côté site client. Un seul jeu de composants, autant
 * d'identités.
 */

export interface TenantTheme {
  /** Nom interne du thème. Thèmes livrés : 'default' | 'mg-perfume'. */
  preset: 'default' | 'mg-perfume'
  /** Nom affiché dans l'admin. */
  label: string

  colors: {
    /** Fond de page. */
    bg: string
    /** Fond des cartes / surfaces surélevées. */
    surface: string
    /** Fond des champs de saisie, zones creuses. */
    inset: string
    /** Encre principale — titres et boutons primaires. */
    ink: string
    /** Texte courant. */
    body: string
    /** Texte secondaire. */
    muted: string
    /** Bordures. */
    border: string
    /** Accent principal (CTA, sur-titres). */
    accent: string
    /** Variante assombrie de l'accent, pour le texte. */
    accentText: string
    /** Fond très clair teinté accent, pour les badges. */
    accentSoft: string
  }

  fonts: {
    /** Titres de marque et d'écran. */
    display: string
    /** Texte courant. */
    body: string
    /** Libellés en petites capitales. */
    label: string
  }

  radius: {
    card: string
    modal: string
    control: string
  }

  /** Logo affiché dans l'en-tête de l'admin (chemin public). */
  logo?: string
  /** Sous-titre affiché sous le nom du tenant dans l'admin. */
  tagline?: string
}

/**
 * Thème par défaut — neutre, dérivé de l'identité Continental
 * (blanc, encre noire, accent terre cuite).
 */
export const defaultTheme: TenantTheme = {
  preset: 'default',
  label: 'Par défaut',
  colors: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    inset: '#F7F7F7',
    ink: '#16130F',
    body: '#4A443E',
    muted: '#8B837A',
    border: '#E5E5E5',
    accent: '#16130F',
    accentText: '#16130F',
    accentSoft: '#F5F5F5',
  },
  fonts: {
    // Serif de contraste pour les titres, sans-serif pour le reste : c'est
    // ce qui évite l'ascenseur typographique « tout en une seule police ».
    display: "'Instrument Serif', Georgia, serif",
    body: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
    label: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
  },
  radius: { card: '20px', modal: '24px', control: '9999px' },
  logo: '/brand/logo.png',
  tagline: 'Administration du site',
}

/**
 * Thème MG Perfume — relevé sur le portail existant.
 *
 * Source : SPEC_ADMIN_MG.md § A. Les 16 valeurs relevées, avec leur fréquence
 * d'usage, pour que la restitution soit vérifiable. La police d'origine
 * (`font-luxury`, hors fichier du composant) est reconstituée ici.
 */
export const mgPerfumeTheme: TenantTheme = {
  preset: 'mg-perfume',
  label: 'MG Perfume',
  colors: {
    bg: '#FAF8F5',          // crème, 27 occurrences
    surface: '#FFFFFF',
    inset: '#221F1B',        // champ de saisie
    ink: '#171513',         // encre + bouton primaire, 86 occurrences
    body: '#6B655E',         // 18 occurrences
    muted: '#9E968D',        // 21 occurrences
    border: '#E8DCC2',       // bordure chaude, 67 occurrences
    accent: '#C59B3F',       // or principal, 156 occurrences
    accentText: '#967120',   // or texte, 69 occurrences
    accentSoft: '#FBF4E2',   // badge crème
  },
  fonts: {
    // `font-luxury` dans l'original — reconstituée avec les familles
    // disponibles ; le gras et l'interlettrage d'origine sont conservés.
    display: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
    body: "'Inter', Arial, sans-serif",
    label: "'Inter', Arial, sans-serif",
  },
  radius: { card: '16px', modal: '24px', control: '9999px' },
  logo: '/images/brand/logo.png',
  tagline: 'MG Perfume Dakar',
}

export const THEMES: Record<TenantTheme['preset'], TenantTheme> = {
  default: defaultTheme,
  'mg-perfume': mgPerfumeTheme,
}

export function getTheme(preset: unknown): TenantTheme {
  const key = (typeof preset === 'string' ? preset : 'default') as TenantTheme['preset']
  return THEMES[key] ?? defaultTheme
}

/**
 * Fusionne un thème stocké en base avec le preset de référence.
 *
 * Permet à un client de ne surcharger que `colors.accent` : les autres tokens
 * suivent le preset, donc une mise à jour du preset se répercute partout.
 */
export function resolveTheme(stored: unknown): TenantTheme {
  const base = getTheme((stored as { preset?: string } | null)?.preset)
  if (!stored || typeof stored !== 'object') return base

  const s = stored as Partial<TenantTheme>
  return {
    ...base,
    ...s,
    colors: { ...base.colors, ...(s.colors ?? {}) },
    fonts: { ...base.fonts, ...(s.fonts ?? {}) },
    radius: { ...base.radius, ...(s.radius ?? {}) },
  }
}

/** Variables CSS du thème, injectées dans une balise <style>. */
export function themeToCssVars(theme: TenantTheme): string {
  const v = {
    '--bg': theme.colors.bg,
    '--surface': theme.colors.surface,
    '--inset': theme.colors.inset,
    '--ink': theme.colors.ink,
    '--body': theme.colors.body,
    '--muted': theme.colors.muted,
    '--border': theme.colors.border,
    '--accent': theme.colors.accent,
    '--accent-text': theme.colors.accentText,
    '--accent-soft': theme.colors.accentSoft,
    '--font-display': theme.fonts.display,
    '--font-body': theme.fonts.body,
    '--font-label': theme.fonts.label,
    '--radius-card': theme.radius.card,
    '--radius-modal': theme.radius.modal,
    '--radius-control': theme.radius.control,
  }
  return `:root{${Object.entries(v).map(([k, val]) => `${k}:${val}`).join(';')}}`
}