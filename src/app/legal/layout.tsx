import Link from 'next/link';
import { LEGAL_PROSE } from '@/components/legal/legal-prose';
import { CalendarCheck, ChevronLeft } from 'lucide-react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container flex items-center justify-between py-4">
          <Link href="/" className="inline-flex items-center gap-1.5 font-semibold text-foreground">
            <CalendarCheck className="size-5 text-primary" /> Yoyaku
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> トップへ戻る
          </Link>
        </div>
      </header>
      <div className="container max-w-3xl py-10">
        <article className={`rounded-xl border bg-white p-6 sm:p-10 ${LEGAL_PROSE} [&_h1]:text-2xl`}>
          {children}
        </article>
        <nav className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <Link href="/legal/terms" className="hover:text-foreground hover:underline">利用規約</Link>
          <Link href="/legal/privacy" className="hover:text-foreground hover:underline">プライバシーポリシー</Link>
          <Link href="/legal/tokushoho" className="hover:text-foreground hover:underline">特定商取引法に基づく表記</Link>
        </nav>
      </div>
    </main>
  );
}
