/* eslint-disable @next/next/no-img-element */
// 画像は saveImage で webp 最適化済みを配信するため、next/image の再最適化は不要。
// 公開ホームページ（SEO）本体。完全サーバーレンダリング。テーマカラーで装飾を統一。
import { CalendarCheck, Clock, Globe, Instagram, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { PublicHomepage } from '@/server/services/shop-homepage-service';
import { DAY_JP, addressLine, formatYen, groupHours, minutesToHHMM } from '@/lib/homepage-seo';

const DEFAULT_BRAND = '#4f46e5';

/** 背景色に対して読みやすい文字色（簡易輝度判定）。 */
function readableText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#0f172a' : '#ffffff';
}

const NOTICE_DOW = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD → 「1月5日(月)」。曜日まで出さないと客が日付を読み違える。 */
function formatNoticeDate(date: string): string {
  const dt = new Date(`${date}T00:00:00Z`);
  return `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日(${NOTICE_DOW[dt.getUTCDay()]})`;
}

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

interface Props {
  hp: PublicHomepage;
}

export function Storefront({ hp }: Props) {
  const p = hp.profile;
  const brand = p.themeColor || DEFAULT_BRAND;
  const onBrand = readableText(brand);
  const heroUrl = p.heroImageKey ? `/uploads/${p.heroImageKey}` : null;
  const logoUrl = p.logoImageKey ? `/uploads/${p.logoImageKey}` : null;
  const addr = addressLine(hp);
  const bookHref = `/book/${hp.slug}`;
  const hours = groupHours(hp.hours);

  // 営業時間表だけを信じて来店した客が閉まった店の前に立つ——を防ぐ。
  // 祝日休業の設定と、直近の臨時休業・特別営業をページ上に必ず出す。
  const notices = [
    ...hp.specialDays.map((sp) => ({
      date: sp.date,
      label:
        sp.type === 'CLOSED'
          ? '休業'
          : sp.openMinute != null && sp.closeMinute != null
            ? `${minutesToHHMM(sp.openMinute)}〜${minutesToHHMM(sp.closeMinute)}`
            : '営業',
      closed: sp.type === 'CLOSED',
      note: sp.reason,
    })),
    // 祝日休業の店では祝日も「その日は閉まっている」情報として並べる
    ...hp.upcomingHolidays
      .filter((h) => !hp.specialDays.some((sp) => sp.date === h.date))
      .map((h) => ({ date: h.date, label: '休業', closed: true, note: h.name })),
  ]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 8);

  const sns = (
    [
      p.instagramUrl && { href: p.instagramUrl, icon: Instagram, label: 'Instagram' },
      p.lineUrl && { href: p.lineUrl, icon: MessageCircle, label: 'LINE' },
      p.xUrl && { href: p.xUrl, icon: XIcon, label: 'X' },
      p.websiteUrl && { href: p.websiteUrl, icon: Globe, label: 'ウェブサイト' },
    ].filter(Boolean) as { href: string; icon: typeof Globe; label: string }[]
  ).filter((s) => /^https?:\/\//i.test(s.href)); // 検証層に加えた二重防御（javascript: 等を描画しない）

  const brandBtn = { backgroundColor: brand, color: onBrand } as const;

  // メニューをカテゴリ別にグループ化
  const menuGroups = groupByCategory(hp.services);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* 管理画面からの下書きプレビュー。公開ページには出ない。 */}
      {hp.preview && (
        <div className="sticky top-0 z-50 bg-amber-400 px-4 py-2 text-center text-sm font-medium text-amber-950">
          プレビュー表示中です。この内容はまだ公開されていません。
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt={hp.name} className="size-9 shrink-0 rounded-lg object-contain" width={36} height={36} />
            ) : (
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                style={brandBtn}
              >
                {hp.name.slice(0, 1)}
              </span>
            )}
            <span className="truncate text-base font-bold text-slate-900">{hp.name}</span>
          </div>
          <div className="flex items-center gap-2">
            {hp.phone && (
              <a
                href={telHref(hp.phone)}
                className="hidden items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex"
              >
                <Phone className="size-4" /> {hp.phone}
              </a>
            )}
            {hp.bookingEnabled && (
              <a
                href={bookHref}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition-transform hover:-translate-y-0.5"
                style={brandBtn}
              >
                <CalendarCheck className="size-4" /> ネット予約
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {heroUrl ? (
          <>
            {/* 画像は縦横比を保ったまま中央基準で敷き詰める。文字の可読性は下のグラデーションで担保。 */}
            <img
              src={heroUrl}
              alt={`${hp.name}の店内`}
              className="absolute inset-0 size-full object-cover object-center"
            />
            {/* 柄の強い画像（バナー等）でも文字が読めるようにスクリムを重ねる。
                文字が全幅に回り込むモバイルは縦方向、左寄せになる PC は左を重点的に暗くする。 */}
            <div className="absolute inset-0 bg-black/35" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/60 sm:hidden" />
            <div className="absolute inset-0 hidden bg-gradient-to-r from-black/70 via-black/40 to-black/10 sm:block" />
          </>
        ) : (
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${brand} 0%, #0f172a 130%)` }} />
        )}
        {/* ヒーローの高さは画面幅に対する比率で決める（極端に拡大されて絵柄が潰れるのを防ぐ）。 */}
        <div className="relative mx-auto flex min-h-[22rem] max-w-5xl flex-col items-start justify-center gap-5 px-4 py-16 sm:min-h-[26rem] sm:py-20 lg:min-h-[30rem]">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur">
            <MapPin className="size-3.5" /> {addr || '当店へようこそ'}
          </span>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-sm sm:text-6xl">
            {hp.name}
          </h1>
          {p.tagline && <p className="max-w-2xl text-lg font-medium leading-relaxed text-white/90 sm:text-xl">{p.tagline}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {hp.bookingEnabled && (
              <a
                href={bookHref}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold shadow-lg transition-transform hover:-translate-y-0.5"
                style={brandBtn}
              >
                <CalendarCheck className="size-5" /> ネットで予約する
              </a>
            )}
            {hp.phone && (
              <a
                href={telHref(hp.phone)}
                className="inline-flex items-center gap-2 rounded-full bg-white/95 px-6 py-3 text-base font-semibold text-slate-900 shadow-lg transition-transform hover:-translate-y-0.5"
              >
                <Phone className="size-5" /> 電話で予約
              </a>
            )}
          </div>
        </div>
      </section>

      {/* In-page nav */}
      <nav className="sticky top-[57px] z-30 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2 text-sm">
          {p.about && <AnchorLink href="#about" label="当店について" />}
          {p.showMenu && hp.services.length > 0 && <AnchorLink href="#menu" label="メニュー・料金" />}
          {p.showStaff && hp.staff.length > 0 && <AnchorLink href="#staff" label="スタッフ" />}
          {p.showGallery && p.gallery.length > 0 && <AnchorLink href="#gallery" label="ギャラリー" />}
          <AnchorLink href="#access" label="アクセス・営業時間" />
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-4">
        {/* About */}
        {p.about && (
          <Section id="about" title="当店について" brand={brand}>
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-slate-700">{p.about}</p>
          </Section>
        )}

        {/* Menu */}
        {p.showMenu && hp.services.length > 0 && (
          <Section id="menu" title="メニュー・料金" brand={brand}>
            <div className="space-y-8">
              {menuGroups.map((g) => (
                <div key={g.category ?? '_'}>
                  {g.category && (
                    <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">{g.category}</h3>
                  )}
                  <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                    {g.items.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-4 p-4">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{s.name}</div>
                          {s.description && (
                            <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{s.description}</p>
                          )}
                          <div className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                            <Clock className="size-3.5" /> {s.durationMin}分
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {s.salePriceJpy != null ? (
                            <>
                              <div className="text-sm text-slate-400 line-through">{formatYen(s.priceJpy)}</div>
                              <div className="text-lg font-bold" style={{ color: brand }}>
                                {formatYen(s.salePriceJpy)}
                              </div>
                            </>
                          ) : (
                            <div className="text-lg font-bold text-slate-900">{formatYen(s.priceJpy)}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {hp.bookingEnabled && (
              <div className="mt-6 text-center">
                <a
                  href={bookHref}
                  className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold shadow-md transition-transform hover:-translate-y-0.5"
                  style={brandBtn}
                >
                  <CalendarCheck className="size-5" /> このメニューを予約する
                </a>
              </div>
            )}
          </Section>
        )}

        {/* Staff */}
        {p.showStaff && hp.staff.length > 0 && (
          <Section id="staff" title="スタッフ" brand={brand}>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {hp.staff.map((st) => (
                <div key={st.id} className="rounded-2xl border border-slate-100 p-5 text-center">
                  {st.avatarUrl ? (
                    <img
                      src={st.avatarUrl}
                      alt={st.displayName ?? st.name}
                      className="mx-auto size-20 rounded-full object-cover"
                      width={80}
                      height={80}
                    />
                  ) : (
                    <span
                      className="mx-auto flex size-20 items-center justify-center rounded-full text-2xl font-bold"
                      style={brandBtn}
                    >
                      {(st.displayName ?? st.name).slice(0, 1)}
                    </span>
                  )}
                  <div className="mt-3 font-semibold text-slate-900">{st.displayName ?? st.name}</div>
                  {st.bio && <p className="mt-1 text-sm leading-relaxed text-slate-500">{st.bio}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Gallery */}
        {p.showGallery && p.gallery.length > 0 && (
          <Section id="gallery" title="ギャラリー" brand={brand}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {p.gallery.map((key) => (
                <img
                  key={key}
                  src={`/uploads/${key}`}
                  alt={`${hp.name}の写真`}
                  className="aspect-square w-full rounded-xl object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          </Section>
        )}

        {/* Access & Hours */}
        <Section id="access" title="アクセス・営業時間" brand={brand}>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-4">
              {(addr || p.accessNote) && (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0" style={{ color: brand }} />
                  <div className="text-[15px] text-slate-700">
                    {hp.postalCode && <div className="text-sm text-slate-400">〒{hp.postalCode}</div>}
                    {addr}
                    {p.accessNote && <p className="mt-1 text-sm text-slate-500">{p.accessNote}</p>}
                  </div>
                </div>
              )}
              {hp.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="size-5 shrink-0" style={{ color: brand }} />
                  <a href={telHref(hp.phone)} className="text-[15px] font-medium text-slate-700 hover:underline">
                    {hp.phone}
                  </a>
                </div>
              )}
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 size-5 shrink-0" style={{ color: brand }} />
                <table className="text-[15px] text-slate-700">
                  <tbody>
                    {hours.map((h) => {
                      const d = h.days[0]!;
                      const closed = h.label === '定休日';
                      return (
                        <tr key={d}>
                          <td className="py-0.5 pr-4 font-medium text-slate-500">{DAY_JP[d]}</td>
                          <td className={closed ? 'py-0.5 text-slate-400' : 'py-0.5'}>{h.label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hp.closeOnNationalHolidays && (
                <p className="pl-8 text-sm text-slate-500">※ 祝日は休業いたします。</p>
              )}
              {notices.length > 0 && (
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="text-sm font-bold text-slate-700">直近の休業・営業時間のお知らせ</div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {notices.map((n) => (
                      <li key={`${n.date}-${n.label}`} className="flex flex-wrap items-baseline gap-x-3">
                        <span className="tabular-nums text-slate-500">{formatNoticeDate(n.date)}</span>
                        <span className={n.closed ? 'font-medium text-rose-600' : 'font-medium text-slate-800'}>
                          {n.label}
                        </span>
                        {n.note && <span className="text-slate-400">{n.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {addr && (
              <div className="overflow-hidden rounded-2xl border border-slate-100">
                <iframe
                  title={`${hp.name}の地図`}
                  src={`https://www.google.com/maps?q=${encodeURIComponent(addr)}&output=embed`}
                  className="h-64 w-full md:h-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}
          </div>
        </Section>
      </main>

      {/* Footer CTA */}
      <footer className="mt-12 border-t border-slate-100 bg-slate-50">
        <div className="mx-auto max-w-5xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold text-slate-900">{hp.name}</h2>
          {addr && <p className="mt-1 text-sm text-slate-500">{addr}</p>}
          {hp.bookingEnabled && (
            <div className="mt-6">
              <a
                href={bookHref}
                className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-base font-semibold shadow-md transition-transform hover:-translate-y-0.5"
                style={brandBtn}
              >
                <CalendarCheck className="size-5" /> ネットで予約する
              </a>
            </div>
          )}
          {sns.length > 0 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              {sns.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={s.label}
                  className="flex size-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                >
                  <s.icon className="size-5" />
                </a>
              ))}
            </div>
          )}
          <p className="mt-8 text-xs text-slate-400">
            Powered by{' '}
            <a href="https://yoyaku.arcs-ai.com" target="_blank" rel="noopener noreferrer" className="hover:underline">
              Yoyaku
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, title, brand, children }: { id: string; title: string; brand: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-slate-100 py-12 first:border-t-0 sm:py-16">
      <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
        <span className="inline-block h-6 w-1.5 rounded-full" style={{ backgroundColor: brand }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function AnchorLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="shrink-0 rounded-full px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    >
      {label}
    </a>
  );
}

/** X（旧Twitter）のロゴ。lucide に無いため簡易 SVG。 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function groupByCategory(services: PublicHomepage['services']) {
  const groups: { category: string | null; items: PublicHomepage['services'] }[] = [];
  const index = new Map<string, number>();
  for (const s of services) {
    const cat = s.category && s.category.trim() !== '' ? s.category.trim() : null;
    const key = cat ?? '_uncat';
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ category: cat, items: [] });
    }
    groups[index.get(key)!]!.items.push(s);
  }
  return groups;
}
