import type { Metadata } from 'next';
import { TermsBody } from '@/components/legal/terms-body';

export const metadata: Metadata = { title: '利用規約' };

export default function TermsPage() {
  return <TermsBody />;
}
