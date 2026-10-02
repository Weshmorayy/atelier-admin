import type { Config } from 'tailwindcss'

/**
 * Les couleurs ne sont PAS déclarées ici : elles viennent du thème du tenant
 * via des variables CSS (voir globals.css et core/theme.ts). Un seul jeu de
 * composants sert ainsi toutes les identités.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
