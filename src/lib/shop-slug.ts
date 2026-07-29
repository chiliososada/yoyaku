/**
 * 店舗 slug の予約語。
 *
 * 店舗の専属ホームページはルート `/{slug}` で配信されるため、slug が既存/将来の
 * トップレベル経路と衝突すると事故る（例: 誰かが slug="admin" を取ると /admin を隠す
 * ことはない＝Next は静的経路優先だが、逆に予約ページが開けない等の混乱を招く）。
 * ここで公開経路・システム経路・将来使いそうな語を包括的に禁止する。
 */
const RESERVED = new Set<string>([
  // 現行トップレベル経路
  'admin',
  'api',
  'book',
  'booking',
  'guide',
  'legal',
  'platform',
  'login',
  'logout',
  'signin',
  'signout',
  'forgot-password',
  'reset-password',
  // 配信・システム
  'uploads',
  'static',
  'assets',
  'public',
  '_next',
  'well-known',
  'favicon',
  'favicon.ico',
  'icon',
  'manifest',
  'sitemap',
  'sitemap.xml',
  'robots',
  'robots.txt',
  's',
  // 将来使いそうな語（先に予約しておく）
  'about',
  'account',
  'blog',
  'company',
  'contact',
  'dashboard',
  'docs',
  'download',
  'faq',
  'help',
  'home',
  'index',
  'news',
  'pricing',
  'privacy',
  'register',
  'settings',
  'signup',
  'status',
  'support',
  'terms',
  'app',
  'www',
  'mail',
  'demo',
  'null',
  'undefined',
]);

/** 予約語か（大文字小文字を無視）。 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED.has(slug.trim().toLowerCase());
}
