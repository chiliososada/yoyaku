/**
 * 法務文書の組版クラス。ページと同意モーダルで共有する。
 *
 * このプロジェクトは @tailwindcss/typography を入れていないため `prose` は効かない。
 * 各所で個別に書くと、同じ規約がページとモーダルで別の見た目になり、
 * 「モーダルで読んだものと違うのでは」という不信を生む。
 * 見出し(h1)の大きさだけは文脈で変えたいので、利用側で指定する。
 */
export const LEGAL_PROSE = [
  '[&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mt-8 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-700',
  '[&_li]:mt-1.5 [&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-700',
  '[&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_table]:mt-4 [&_table]:w-full [&_table]:text-sm',
].join(' ');
