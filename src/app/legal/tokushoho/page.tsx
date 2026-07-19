import type { Metadata } from 'next';

export const metadata: Metadata = { title: '特定商取引法に基づく表記 | Yoyaku' };

const ROWS: Array<[string, React.ReactNode]> = [
  ['販売事業者', 'マイアークス株式会社'],
  ['代表責任者', '劉 子源'],
  ['所在地', '東京都葛飾区（ご請求があった場合、遅滞なく開示いたします。下記メールアドレスまでご請求ください）'],
  ['電話番号', '080-4051-5888（受付時間: 平日 10:00〜18:00）'],
  ['メールアドレス', 'ryu@arcs-ai.com'],
  ['販売URL', 'https://yoyaku.arcs-ai.com'],
  ['販売価格', '各プランの申込画面に表示する金額（月額・税込）'],
  ['商品代金以外の必要料金', 'インターネット接続にかかる通信費等はお客様のご負担となります'],
  ['お支払い方法', 'クレジットカード決済（Stripe）'],
  ['お支払い時期', '初回はお申込み時、以降は毎月の更新日に自動決済されます'],
  ['サービスの提供時期', '決済完了後、直ちにご利用いただけます'],
  [
    '解約について',
    '管理画面の「契約・お支払い」からいつでも解約いただけます。解約後も当該請求期間の末日までご利用可能です。日割りでの返金は行いません。',
  ],
  [
    '返品・キャンセル',
    'サービスの性質上、提供開始後の返金には応じられません。無料トライアル期間中は料金は発生しません。',
  ],
  ['動作環境', '最新版の Google Chrome / Safari / Microsoft Edge 等のモダンブラウザ'],
];

export default function TokushohoPage() {
  return (
    <>
      <h1>特定商取引法に基づく表記</h1>
      <table>
        <tbody>
          {ROWS.map(([label, value]) => (
            <tr key={label} className="border-b last:border-0">
              <th className="w-44 py-3 pr-4 text-left align-top text-sm font-medium text-slate-500">
                {label}
              </th>
              <td className="py-3 text-sm leading-relaxed text-slate-700">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="!mt-8 text-xs text-slate-400">最終更新日: 2026年7月19日</p>
    </>
  );
}
