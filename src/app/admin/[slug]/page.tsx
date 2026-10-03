import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, Plus, AlertTriangle, Check } from 'lucide-react'

import { resolveSession } from '@/core/session'
import { getDashboard, relativeTime } from '@/core/dashboard'
import { allModules, getModule, type ModuleKey } from '@/core/modules'

export const dynamic = 'force-dynamic'

const nf = new Intl.NumberFormat('fr-FR')

/** « product » + « create » → « Produit créé ». Le journal est technique, l'écran ne l'est pas. */
const ENTITY_LABEL: Record<string, string> = {
  product: 'Produit', category: 'Catégorie', banner: 'Bannière',
  lead: 'Message', media: 'Média', settings: 'Réglages',
  post: 'Article', faq: 'Question', user: 'Utilisateur', tenant: 'Site',
}
const ACTION_LABEL: Record<string, string> = {
  create: 'créé', update: 'modifié', delete: 'supprimé',
  publish: 'publié', unpublish: 'dépublié',
}

function Stat({
  href, value, unit, label, detail,
}: {
  href: string
  value: string
  unit?: string
  label: string
  detail?: string
}) {
  return (
    <Link href={href} className="stat-tile group">
      <p className="label" style={{ color: 'var(--muted)' }}>{label}</p>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="stat-value">{value}</span>
        {unit ? <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>{unit}</span> : null}
      </p>
      {detail ? (
        <p className="mt-1 truncate text-xs" style={{ color: 'var(--muted)' }}>{detail}</p>
      ) : null}
      <ArrowUpRight
        size={16}
        className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-60"
        style={{ color: 'var(--muted)' }}
        aria-hidden
      />
    </Link>
  )
}

export default async function TenantHome({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session = await resolveSession(slug)
  if (!session) redirect('/connexion')

  const { tenant, user } = session
  const modules = tenant.modules
  const data = await getDashboard(session.ctx, modules)

  /** Modules avec un écran : ce sont les seuls à figurer dans la navigation. */
  const screens = allModules().filter((m) => modules.includes(m.key) && m.adminRoutes.length > 0)
  const hrefFor = (key: ModuleKey) => `/admin/${slug}${getModule(key).adminRoutes[0].replace('/admin', '')}`
  const on = (key: ModuleKey) => modules.includes(key)

  const firstName = user.name?.trim().split(/\s+/)[0] || user.email.split('@')[0]

  /* Tuiles : uniquement ce dont le site dispose réellement. Un module absent
     ne vaut pas un « 0 » — il ne vaut pas une tuile. */
  const stats: { key: string; node: React.ReactNode }[] = []
  if (on('products')) {
    stats.push({
      key: 'products',
      node: (
        <Stat
          href={hrefFor('products')}
          value={nf.format(data.products)}
          label="Produits"
          detail={data.products === data.activeProducts
            ? 'Tous en ligne'
            : `${data.activeProducts} en ligne · ${data.products - data.activeProducts} masqué${data.products - data.activeProducts > 1 ? 's' : ''}`}
        />
      ),
    })
  }
  if (on('categories')) {
    stats.push({
      key: 'categories',
      node: (
        <Stat
          href={hrefFor('categories')}
          value={nf.format(data.categories)}
          label="Catégories"
          detail={data.categories > 0 ? 'Familles du catalogue' : 'Aucune famille définie'}
        />
      ),
    })
  }
  if (on('products') && data.catalogueValue > 0) {
    stats.push({
      key: 'value',
      node: (
        <Stat
          href={hrefFor('products')}
          value={nf.format(data.catalogueValue)}
          unit="FCFA"
          label="Valeur du catalogue"
          detail="Produits en ligne, prix de vente cumulé"
        />
      ),
    })
  }
  if (on('leads')) {
    stats.push({
      key: 'leads',
      node: (
        <Stat
          href={hrefFor('leads')}
          value={nf.format(data.leads)}
          label="Messages"
          detail={data.newLeads > 0 ? `${data.newLeads} à traiter` : 'Aucun en attente'}
        />
      ),
    })
  }
  if (on('media')) {
    stats.push({
      key: 'media',
      node: (
        <Stat href={hrefFor('media')} value={nf.format(data.media)} label="Médias"
          detail="Images et documents versés" />
      ),
    })
  }

  return (
    <div className="pb-16">
      {/* En-tête — l'identité du site d'abord, jamais le nom de l'outil. */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label" style={{ color: 'var(--muted)' }}>{tenant.name}</p>
          <h1 className="page-title mt-2">Bonjour, {firstName}.</h1>
          <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--muted)' }}>
            {data.health.length > 0
              ? `${data.health.length} point${data.health.length > 1 ? 's' : ''} demande${data.health.length > 1 ? 'nt' : ''} votre attention.`
              : 'Le site est complet. Rien à signaler.'}
          </p>
        </div>

        <div className="flex gap-2">
          {on('settings') ? (
            <Link href={hrefFor('settings')} className="btn-ghost">Réglages</Link>
          ) : null}
          {on('products') ? (
            <Link href={`/admin/${slug}/products/nouveau`} className="btn-primary">
              <Plus size={15} strokeWidth={2.2} aria-hidden /> Nouveau produit
            </Link>
          ) : null}
        </div>
      </header>

      {/* Compteurs */}
      {stats.length > 0 ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => <div key={s.key}>{s.node}</div>)}
        </div>
      ) : null}

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {/* Activité — le journal d'audit, lisible par un humain. */}
        <section className="card p-6 lg:col-span-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Activité récente
          </h2>
          {data.activity.length === 0 ? (
            <p className="mt-4 text-sm" style={{ color: 'var(--muted)' }}>
              Aucune modification enregistrée pour l'instant.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col">
              {data.activity.map((a, i) => (
                <li
                  key={`${a.entity}-${a.createdAt}-${i}`}
                  className="flex items-baseline gap-3 py-2.5"
                  style={i > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
                >
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: 'var(--ink)' }} aria-hidden />
                  <p className="min-w-0 flex-1 text-sm" style={{ color: 'var(--body)' }}>
                    <span style={{ color: 'var(--ink)' }}>
                      {ENTITY_LABEL[a.entity] ?? a.entity}
                    </span>{' '}
                    {ACTION_LABEL[a.action] ?? a.action}
                  </p>
                  <p className="flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>
                    {a.actorEmail ?? 'système'}
                  </p>
                  <p className="w-24 flex-shrink-0 text-right text-xs tabular-nums"
                    style={{ color: 'var(--muted)' }}>
                    {relativeTime(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* À vérifier — des actions, pas des décorations. */}
        <section className="card p-6">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>À vérifier</h2>

          {data.health.length === 0 ? (
            <div className="mt-4 flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--muted)' }} aria-hidden>
                <Check size={16} strokeWidth={2} />
              </span>
              <p className="text-sm" style={{ color: 'var(--body)' }}>
                Catalogue, images et coordonnées sont en place. Le site est prêt à être publié.
              </p>
            </div>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {data.health.map((h) => (
                <li key={h.id}>
                  <Link href={hrefFor(h.module)} className="group block">
                    <p className="flex items-start gap-2.5 text-sm font-medium"
                      style={{ color: 'var(--ink)' }}>
                      <span className="mt-0.5 flex-shrink-0"
                        style={{ color: h.severity === 'critique' ? 'var(--ink)' : 'var(--muted)' }}
                        aria-hidden>
                        <AlertTriangle size={15} strokeWidth={2} />
                      </span>
                      {h.label}
                    </p>
                    <p className="mt-1 pl-[26px] text-xs leading-relaxed"
                      style={{ color: 'var(--muted)' }}>
                      {h.detail}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Catalogue — les vrais produits, avec leurs images. */}
      {data.recentProducts.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              Catalogue
            </h2>
            {on('products') ? (
              <Link href={hrefFor('products')} className="label" style={{ color: 'var(--muted)' }}>
                Tout voir →
              </Link>
            ) : null}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.recentProducts.map((p) => (
              <Link
                key={p.id}
                href={`/admin/${slug}/products/${p.id}`}
                className="card group overflow-hidden transition-shadow hover:shadow-md"
              >
                <div className="flex h-32 items-center justify-center p-4"
                  style={{ background: 'var(--inset)' }}>
                  {p.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={p.image}
                      alt={p.imageAlt ?? p.name}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <span className="label" style={{ color: 'var(--muted)' }}>Sans image</span>
                  )}
                </div>
                <div className="p-4">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {p.name}
                  </p>
                  <div className="mt-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                      {nf.format(Number(p.price))} <span className="text-[10px] font-medium">FCFA</span>
                    </span>
                    {!p.inStock ? (
                      <span className="chip" style={{ color: 'var(--muted)' }}>Rupture</span>
                    ) : null}
                  </div>
                  {p.categoryLabel ? (
                    <p className="mt-1.5 truncate text-[11px]" style={{ color: 'var(--muted)' }}>
                      {p.categoryLabel}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Modules — en dernier, comme un sommaire, pas comme une page d'accueil. */}
      {screens.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Gestion</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {screens.map((m) => (
              <Link
                key={m.key}
                href={hrefFor(m.key)}
                className="card group flex items-start gap-4 p-5 transition-colors hover:bg-[var(--inset)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{m.label}</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {m.description}
                  </p>
                </div>
                <ArrowUpRight size={16} className="mt-0.5 flex-shrink-0"
                  style={{ color: 'var(--muted)' }} aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}