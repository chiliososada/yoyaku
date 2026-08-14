import type { Metadata } from 'next';
import { PrivacyBody } from '@/components/legal/privacy-body';

export const metadata: Metadata = { title: 'プライバシーポリシー' };

export default function PrivacyPage() {
  return <PrivacyBody />;
}
