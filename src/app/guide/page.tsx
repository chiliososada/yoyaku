import type { Metadata } from 'next';
import { GuideViewer } from './guide-viewer';

export const metadata: Metadata = {
  title: '使い方ガイド | 予約システム',
  description:
    '予約システムの使い方を画面写真つきでステップごとにご紹介。初期設定から集客・日々の運用・お客様の予約体験まで、このガイドだけで始められます。',
};

export default function GuidePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <GuideViewer />
    </main>
  );
}
