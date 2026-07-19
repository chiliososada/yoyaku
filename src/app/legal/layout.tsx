import Link from 'next/link';
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
        <article className="rounded-xl border bg-white p-6 sm:p-10 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:mt-8 [&_h2]:border-b [&_h2]:pb-1.5 [&_h2]:text-base [&_h2]:font-semibold [&_p]:mt-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-slate-700 [&_li]:mt-1.5 [&_li]:text-sm [&_li]:leading-relaxed [&_li]:text-slate-700 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_table]:mt-4 [&_table]:w-full [&_table]:text-sm">
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
