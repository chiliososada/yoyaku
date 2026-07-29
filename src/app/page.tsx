import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CalendarCheck,
  Clock,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { LiffStateRedirect } from '@/components/liff-state-redirect';

// LIFF ID は実行時 env から読む（env_file 注入のためビルド時インライン不可）→ 動的レンダリング必須
export const dynamic = 'force-dynamic';

const features = [
  {
    icon: ShieldCheck,
    title: 'オーバーブッキング防止',
    desc: 'DBトランザクション・排他制約・容量再判定の多層防御。同時アクセスでも最後の1枠を二重に売りません。',
  },
  {
    icon: Clock,
    title: '柔軟な予約ルール',
    desc: '営業時間・祝日・臨時休業・特別営業日・バッファ・受付期間・締切・キャンセル期限に対応。',
  },
  {
    icon: Users,
    title: 'スタッフ指名・コンボ予約',
    desc: 'シフト連動の指名予約（指名料対応）、カット＋カラーなど複数メニューの連続予約、オプション追加。',
  },
];

const portals = [
  {
    href: '/book/demo-salon',
    icon: CalendarCheck,
    title: '予約ページ（デモ）',
    desc: '顧客向けオンライン予約フロー',
    accent: 'bg-primary/10 text-primary',
  },
  {
    href: '/admin',
    icon: Store,
    title: '商家管理',
    desc: '店舗・スタッフ・メニュー・予約・統計',
    accent: 'bg-success/10 text-success',
  },
  {
    href: '/platform',
    icon: Building2,
    title: 'プラットフォーム管理',
    desc: '商家・プラン・ユーザー・監査ログ',
    accent: 'bg-warning/15 text-warning-foreground',
  },
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* LIFF のパス転送受け（?liff.state= 付きアクセスのみ動作。通常アクセスは no-op） */}
      <LiffStateRedirect liffId={env.NEXT_PUBLIC_LIFF_ID ?? null} />
      {/* Hero */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-accent via-accent/40 to-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, hsl(var(--primary) / 0.15) 0, transparent 40%), radial-gradient(circle at 80% 0%, hsl(var(--primary) / 0.12) 0, transparent 45%)',
          }}
        />
        <div className="container relative flex flex-col items-center gap-7 py-20 text-center sm:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-white/80 px-4 py-1.5 text-sm font-medium text-primary shadow-sm backdrop-blur">
            <Sparkles className="size-4" />
            マルチテナント予約管理プラットフォーム
          </div>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-6xl">
            予約を、止めない。
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              取りこぼさない。
            </span>
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            サロン・リラクゼーション・スクールまで。店舗・スタッフ・メニューを横断管理し、
            高い同時アクセスにも耐える商用グレードの予約基盤。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-7 text-base shadow-lg shadow-primary/25">
              <Link href="/book/demo-salon">
                予約ページを見る <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 bg-white/80 px-7 text-base backdrop-blur">
              <Link href="/signup">30日間 無料ではじめる</Link>
            </Button>
            <Button asChild size="lg" variant="ghost" className="h-12 px-6 text-base">
              <Link href="/guide">📖 使い方ガイド</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            初期費用0円・カード登録不要。すでにご利用の方は{' '}
            <Link href="/admin" className="text-primary hover:underline">
              管理画面へ
            </Link>
            。
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="container grid gap-5 py-16 sm:py-20 md:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="group rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/5"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
              <f.icon className="size-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* Portals */}
      <section className="border-t bg-slate-50/80">
        <div className="container py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight">入口</h2>
          <p className="mt-1 text-center text-sm text-muted-foreground">目的の画面からお進みください</p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {portals.map((p) => (
              <Link key={p.href} href={p.href} className="group">
                <div className="flex h-full items-start gap-4 rounded-2xl border bg-white p-5 shadow-sm transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40 group-hover:shadow-md">
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${p.accent}`}>
                    <p.icon className="size-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1 font-semibold">
                      {p.title}
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t py-8">
        <div className="container flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <CalendarCheck className="size-4 text-primary" /> Yoyaku SaaS
          </span>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs">
            <Link href="/guide" className="hover:text-foreground hover:underline">使い方ガイド</Link>
            <Link href="/legal/terms" className="hover:text-foreground hover:underline">利用規約</Link>
            <Link href="/legal/privacy" className="hover:text-foreground hover:underline">プライバシーポリシー</Link>
            <Link href="/legal/tokushoho" className="hover:text-foreground hover:underline">特定商取引法に基づく表記</Link>
          </nav>
          <span className="text-xs">© {new Date().getFullYear()} マイアークス株式会社</span>
        </div>
      </footer>
    </main>
  );
}
