'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Plus, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatJpy } from '@/lib/utils';
import {
  DAY_STATUS_LABEL,
  SLOT_REASON_LABEL,
  describeIsoDate,
  formatDateTimeInTz,
  formatTimeInTz,
} from '@/lib/booking-display';

interface Staff {
  id: string;
  name: string;
  displayName: string | null;
  bio: string | null;
  nominationFeeJpy: number;
}
interface ServiceOption {
  id: string;
  name: string;
  priceJpy: number;
  extraDurationMin: number;
}
interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceJpy: number;
  /** セール価格（円）。null=セールなし。設定時は請求額・表示額がこの価格になる。 */
  salePriceJpy: number | null;
  color: string | null;
  requiresStaff: boolean;
  bufferAfterMin: number;
  staffIds: string[];
  options: ServiceOption[];
}

/** 実際に請求・表示する価格（セール価格があればそれ、なければ通常価格）。 */
function effectivePrice(s: Service): number {
  return s.salePriceJpy ?? s.priceJpy;
}
/** セール中か（セール価格が設定され通常料金より安い）。 */
function isOnSale(s: Service): boolean {
  return s.salePriceJpy != null && s.salePriceJpy < s.priceJpy;
}
export interface WizardShop {
  slug: string;
  name: string;
  address: string | null;
  prefecture: string | null;
  city: string | null;
  timezone: string;
  services: Service[];
  staff: Staff[];
}
interface Slot {
  startAt: string;
  serviceEndAt: string;
  endAt: string;
  available: boolean;
  remaining: number;
  reason?: string;
}

type Step = 'service' | 'datetime' | 'form' | 'confirm' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'service', label: 'メニュー' },
  { key: 'datetime', label: '日時' },
  { key: 'form', label: 'お客様情報' },
  { key: 'confirm', label: '確認' },
];

const DATE_MARK: Record<'OPEN' | 'FEW' | 'FULL' | 'CLOSED', { label: string; cls: string }> = {
  OPEN: { label: '○', cls: 'text-green-600' },
  FEW: { label: '△', cls: 'text-amber-600' },
  FULL: { label: '×', cls: 'text-slate-400' },
  CLOSED: { label: '休', cls: 'text-slate-400' },
};

function todayInTz(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ---- 月カレンダー用ヘルパー ----
const pad2 = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM' の月グリッド（前後の空白セルは null）。日曜始まり 7 列。 */
function buildMonthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y!, m! - 1, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y!, m!, 0, 12)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${pad2(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + n, 1, 12));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}`;
}
const monthOf = (dateStr: string) => dateStr.slice(0, 7);
const monthLabel = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
const WEEK_HEADER = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_MONTHS_AHEAD = 2; // 予約受付窓に合わせ、当月から +2 ヶ月まで
const MAX_SERVICES = 3;

export function BookingWizard({ shop, liffId }: { shop: WizardShop; liffId?: string | null }) {
  const [step, setStep] = useState<Step>('service');
  /** serviceId -> 選択オプションID集合（キー存在 = サービス選択中） */
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [staffId, setStaffId] = useState<string | null>(null); // null = おまかせ
  const today = useMemo(() => todayInTz(shop.timezone), [shop.timezone]);
  const [date, setDate] = useState<string>(today);
  const [viewMonth, setViewMonth] = useState<string>(() => monthOf(today));
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dayStatus, setDayStatus] = useState<string>('OPEN');
  const [dateStatus, setDateStatus] = useState<Record<string, 'OPEN' | 'FEW' | 'FULL' | 'CLOSED'>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ name: '', nameKana: '', email: '', phone: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false); // 同期ガード（disabled 反映前の二度押し対策）
  const idempotencyKeyRef = useRef<string | null>(null); // 予約1回分の冪等キー（リトライで再利用、成功で再生成）
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    cancellationToken: string;
    startAt: string;
    totalPriceJpy: number;
  } | null>(null);

  // ---- LINE(LIFF) ネイティブ予約（progressive enhancement）----
  // liffId（サーバーから実行時に渡る）がある時のみ有効。LINE アプリ内で開かれたら
  // LINE プロフィール（userId/表示名）を取得し、氏名/メール入力を省略、確認/リマインドを LINE で送る。
  // 未設定・LINE 外（未ログイン）では従来どおりのウェブ予約として動作（現状不変）。
  const [lineProfile, setLineProfile] = useState<{ userId: string; displayName: string } | null>(null);
  const isLineMode = lineProfile !== null;

  useEffect(() => {
    if (!liffId) return;
    let cancelled = false;
    void (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });
        if (cancelled) return;
        // LIFF ブラウザ内は init が自動ログインを完了させる。liff.login() は外部ブラウザ
        // 専用 API（クライアント内で呼ぶとリロードループの原因）なのでここでは決して呼ばず、
        // 未ログインなら静かにウェブ予約へフォールバックする。
        if (liff.isLoggedIn()) {
          const p = await liff.getProfile();
          if (!cancelled) setLineProfile({ userId: p.userId, displayName: p.displayName });
        }
      } catch {
        /* LIFF 初期化失敗時はウェブ予約として継続（フォールバック） */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  // LINE プロフィール取得後、氏名を表示名で自動補完（未入力時のみ）。
  useEffect(() => {
    if (lineProfile) setForm((f) => (f.name ? f : { ...f, name: lineProfile.displayName }));
  }, [lineProfile]);

  // 予約内容（メニュー/担当/枠/顧客情報）が変わったら冪等キーを無効化。
  // 失敗後に内容を変えて再送した際、サーバが旧内容の予約を「再生」して返すのを防ぐ。
  // 同一内容のリトライではどの依存も変わらないため、キーは維持され冪等のまま。
  useEffect(() => {
    idempotencyKeyRef.current = null;
  }, [picked, staffId, slot, form]);

  const monthGrid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const minMonth = monthOf(today);
  const maxMonth = addMonths(minMonth, MAX_MONTHS_AHEAD);

  /** 選択中サービス（メニュー表示順 = 施術順） */
  const selectedServices = useMemo(
    () => shop.services.filter((s) => picked[s.id] !== undefined),
    [shop.services, picked],
  );
  const selectedCount = selectedServices.length;

  /** 選択オプションの実体 */
  const optionsOf = useCallback(
    (svc: Service) => svc.options.filter((o) => (picked[svc.id] ?? []).includes(o.id)),
    [picked],
  );

  /** 合計金額（サービス+オプション+指名料）・合計目安時間（サービス間の片付け時間込み） */
  const totals = useMemo(() => {
    let price = 0;
    let minutes = 0;
    selectedServices.forEach((svc, i) => {
      const opts = optionsOf(svc);
      price += effectivePrice(svc) + opts.reduce((a, o) => a + o.priceJpy, 0);
      minutes += svc.durationMin + opts.reduce((a, o) => a + o.extraDurationMin, 0);
      if (i < selectedServices.length - 1) minutes += svc.bufferAfterMin; // サービス間の片付け
    });
    const fee = staffId ? (shop.staff.find((s) => s.id === staffId)?.nominationFeeJpy ?? 0) : 0;
    return { price: price + fee, minutes, nominationFee: fee };
  }, [selectedServices, optionsOf, staffId, shop.staff]);

  /** 全サービスを担当できるスタッフ（共通集合） */
  const eligibleStaff = useMemo(() => {
    if (selectedServices.length === 0) return [];
    return shop.staff.filter((st) => selectedServices.every((svc) => svc.staffIds.includes(st.id)));
  }, [selectedServices, shop.staff]);

  const requiresStaff = selectedServices.some((s) => s.requiresStaff);

  // 指名中のスタッフが共通集合から外れたら「おまかせ」に戻す
  useEffect(() => {
    if (staffId && !eligibleStaff.some((s) => s.id === staffId)) setStaffId(null);
  }, [staffId, eligibleStaff]);

  const toggleService = (svc: Service) => {
    setSlot(null);
    setDateStatus({});
    setPicked((prev) => {
      if (prev[svc.id] !== undefined) {
        const { [svc.id]: _removed, ...rest } = prev;
        return rest;
      }
      if (Object.keys(prev).length >= MAX_SERVICES) return prev; // 上限
      return { ...prev, [svc.id]: [] };
    });
  };

  const toggleOption = (svc: Service, optId: string) => {
    setSlot(null);
    setDateStatus({});
    setPicked((prev) => {
      const cur = prev[svc.id];
      if (cur === undefined) return prev;
      return {
        ...prev,
        [svc.id]: cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId],
      };
    });
  };

  /** API クエリ共通パラメータ（コンボ対応） */
  const selectionParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set('serviceIds', selectedServices.map((s) => s.id).join(','));
    const optIds = selectedServices.flatMap((s) => picked[s.id] ?? []);
    if (optIds.length > 0) params.set('optionIds', optIds.join(','));
    if (staffId) params.set('staffId', staffId);
    return params;
  }, [selectedServices, picked, staffId]);

  const fetchSeqRef = useRef(0); // 遅延レスポンスが後勝ちで別日の枠を上書きしないための連番ガード
  const fetchSlots = useCallback(async () => {
    if (selectedServices.length === 0) return;
    const seq = ++fetchSeqRef.current;
    setLoadingSlots(true);
    setError(null);
    try {
      const params = selectionParams();
      params.set('date', date);
      const res = await fetch(`/api/public/shops/${shop.slug}/availability?${params}`);
      const data = await res.json();
      if (seq !== fetchSeqRef.current) return; // 古いリクエストの結果は破棄
      if (!res.ok) throw new Error(data?.error?.message ?? '空き状況の取得に失敗しました。');
      const fresh: Slot[] = data.slots ?? [];
      setSlots(fresh);
      setDayStatus(data.dayStatus ?? 'OPEN');
      // 選択中の枠が最新の空き状況で消えた/埋まったら選択解除（次へで SLOT_FULL に突っ込まない）
      setSlot((prev) =>
        prev && fresh.some((s) => s.startAt === prev.startAt && s.available) ? prev : null,
      );
    } catch (e) {
      if (seq !== fetchSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'エラーが発生しました。');
      setSlots([]);
    } finally {
      if (seq === fetchSeqRef.current) setLoadingSlots(false);
    }
  }, [selectedServices.length, selectionParams, date, shop.slug]);

  useEffect(() => {
    if (step === 'datetime') void fetchSlots();
  }, [step, fetchSlots]);

  // 表示中の月の空き状況サマリ（○△×）を取得。選択/担当/月が変わったら更新。
  const fetchDateSummary = useCallback(async () => {
    if (selectedServices.length === 0) return;
    // 当月は今日から、未来月は1日から、月末まで取得
    const fromDate = viewMonth === minMonth ? today : `${viewMonth}-01`;
    const [vy, vm] = viewMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(vy!, vm!, 0, 12)).getUTCDate();
    const days = daysInMonth - Number(fromDate.slice(8, 10)) + 1;
    if (days <= 0) return;
    try {
      const params = selectionParams();
      params.set('from', fromDate);
      params.set('days', String(days));
      const res = await fetch(`/api/public/shops/${shop.slug}/date-availability?${params}`);
      const data = await res.json();
      if (!res.ok) return;
      setDateStatus((prev) => {
        const map = { ...prev };
        for (const d of data.dates ?? []) map[d.date] = d.status;
        return map;
      });
    } catch {
      /* サマリ取得失敗は致命的でない（マーク非表示で続行） */
    }
  }, [selectedServices.length, selectionParams, viewMonth, minMonth, today, shop.slug]);

  useEffect(() => {
    if (step === 'datetime') void fetchDateSummary();
  }, [step, fetchDateSummary]);

  // 選択中の日が満/休なら、その月の最初の予約可能な日へ自動移動。
  useEffect(() => {
    if (step !== 'datetime') return;
    if (monthOf(date) !== viewMonth) return;
    if (dateStatus[date] === 'FULL' || dateStatus[date] === 'CLOSED' || date < today) {
      const firstOpen = monthGrid.find(
        (d): d is string => !!d && d >= today && (dateStatus[d] === 'OPEN' || dateStatus[d] === 'FEW'),
      );
      if (firstOpen && firstOpen !== date) {
        setDate(firstOpen);
        setSlot(null);
      }
    }
  }, [step, dateStatus, date, viewMonth, monthGrid, today]);

  const submit = async () => {
    if (selectedServices.length === 0 || !slot) return;
    if (submittingRef.current) return; // 二度押しを同期的に弾く（disabled 反映を待たない）
    submittingRef.current = true;
    // この予約試行の冪等キー（未生成なら発番）。同一内容の再送はサーバ側で既存予約を返す。
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/shops/${shop.slug}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceItems: selectedServices.map((s) => ({
            serviceId: s.id,
            optionIds: picked[s.id] ?? [],
          })),
          staffId,
          startAt: slot.startAt,
          customer: {
            name: form.name,
            nameKana: form.nameKana || undefined,
            email: form.email || undefined,
            phone: form.phone || undefined,
          },
          note: form.note || undefined,
          idempotencyKey: idempotencyKeyRef.current,
          // LINE モードなら顧客 userId を同送 → 確認/リマインドが LINE プッシュに。
          lineUserId: lineProfile?.userId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '予約に失敗しました。');
      setResult(data.booking);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '予約に失敗しました。');
      // 失敗時はキーを保持（同一内容の再送を冪等にする）。二度押しガードのみ解除。
      submittingRef.current = false;
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const staffName = (id: string | null) => {
    if (!id) return 'おまかせ';
    const s = shop.staff.find((x) => x.id === id);
    return s?.displayName ?? s?.name ?? '—';
  };
  const menuSummary = selectedServices.map((s) => s.name).join(' + ');

  /** 続けて予約する: ウィザードを初期状態へ戻す（冪等キーも新規化して二重予約を防ぐ）。 */
  const resetWizard = useCallback(() => {
    setStep('service');
    setPicked({});
    setStaffId(null);
    setDate(today);
    setViewMonth(monthOf(today));
    setSlot(null);
    setSlots([]);
    // LINE モードは氏名を表示名で再補完（連携済みのため）。
    setForm({ name: lineProfile?.displayName ?? '', nameKana: '', email: '', phone: '', note: '' });
    setError(null);
    setResult(null);
    submittingRef.current = false;
    idempotencyKeyRef.current = null; // 新しい予約は新しい冪等キーで
  }, [today, lineProfile]);

  // ---- 完了画面 ----
  if (step === 'done' && result) {
    return (
      <div className="mx-auto max-w-lg">
        <Card className="overflow-hidden border-0 shadow-lg">
          <div className="bg-gradient-to-b from-success/10 to-transparent px-6 pt-10 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success text-success-foreground shadow-md shadow-success/30">
              <Check className="size-9" strokeWidth={3} />
            </div>
            <h2 data-testid="complete" className="mt-4 text-2xl font-bold tracking-tight">
              ご予約が完了しました
            </h2>
            <p className="mt-1 font-medium text-primary">
              {formatDateTimeInTz(result.startAt, shop.timezone)} 〜
            </p>
          </div>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="grid gap-0.5 rounded-xl border bg-muted/40 p-4 text-sm">
              <Row label="店舗" value={shop.name} />
              <Row label="メニュー" value={menuSummary} />
              <Row label="担当" value={staffName(staffId)} />
              <Row label="合計金額" value={formatJpy(result.totalPriceJpy)} />
              <Row label="予約番号" value={result.id.slice(-8).toUpperCase()} />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              ご予約内容の確認・キャンセルは下記から行えます。
            </p>
            <Button asChild size="lg" className="w-full">
              <Link href={`/booking/${result.cancellationToken}`}>予約を確認・キャンセル</Link>
            </Button>
            <Button variant="ghost" className="w-full" onClick={resetWizard}>
              続けて予約する
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* ステッパー */}
      <ol className="mb-8 flex items-center justify-between text-xs">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const current = i === stepIndex;
          return (
            <li key={s.key} className="relative flex flex-1 flex-col items-center last:flex-none">
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    'absolute left-1/2 top-4 z-0 h-0.5 w-full',
                    done ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
              <div
                className={cn(
                  'relative z-10 flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-all',
                  done && 'bg-primary text-primary-foreground',
                  current && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
                  !done && !current && 'bg-secondary text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  'mt-1.5',
                  current || done ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* STEP: メニュー（複数選択 + オプション） */}
      {step === 'service' && (
        <div className="grid gap-3 pb-24">
          <p className="text-sm text-muted-foreground">
            ご希望のメニューをお選びください（{MAX_SERVICES}件まで組み合わせ可）
          </p>
          {shop.services.map((s) => {
            const isSelected = picked[s.id] !== undefined;
            const selDisabled = !isSelected && selectedCount >= MAX_SERVICES;
            return (
              <div
                key={s.id}
                className={cn(
                  'overflow-hidden rounded-xl border bg-card shadow-sm transition-all',
                  isSelected ? 'border-primary ring-1 ring-primary/30' : 'hover:border-primary/40',
                )}
              >
                <button
                  data-testid="svc"
                  data-selected={isSelected}
                  disabled={selDisabled}
                  onClick={() => toggleService(s)}
                  className={cn(
                    'relative flex w-full items-center gap-4 p-4 pl-5 text-left',
                    selDisabled && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span
                    className="absolute inset-y-0 left-0 w-1.5"
                    style={{ backgroundColor: s.color ?? 'hsl(var(--primary))' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground">{s.name}</div>
                    {s.description && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {s.description}
                      </div>
                    )}
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                      <Clock className="size-3" /> 約{s.durationMin}分
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {isOnSale(s) ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span className="flex items-center gap-1.5">
                          <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                            {Math.round((1 - effectivePrice(s) / s.priceJpy) * 100)}% OFF
                          </span>
                          <span className="text-xs text-muted-foreground line-through">{formatJpy(s.priceJpy)}</span>
                        </span>
                        <span className="text-lg font-bold tracking-tight text-rose-600">{formatJpy(effectivePrice(s))}</span>
                      </div>
                    ) : (
                      <span className="text-lg font-bold tracking-tight">{formatJpy(s.priceJpy)}</span>
                    )}
                    <span
                      className={cn(
                        'flex size-6 items-center justify-center rounded-full border-2 transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted-foreground/30 text-transparent',
                      )}
                    >
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                  </div>
                </button>

                {/* オプション（選択中のみ展開） */}
                {isSelected && s.options.length > 0 && (
                  <div className="border-t bg-accent/30 px-5 py-3">
                    <p className="mb-2 flex items-center gap-1 text-xs font-medium text-accent-foreground">
                      <Plus className="size-3.5" /> オプション
                    </p>
                    <div className="grid gap-1.5">
                      {s.options.map((o) => {
                        const on = (picked[s.id] ?? []).includes(o.id);
                        return (
                          <label
                            key={o.id}
                            className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent/60"
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleOption(s, o.id)}
                                className="size-4 rounded border-input text-primary focus:ring-ring"
                              />
                              {o.name}
                              {o.extraDurationMin > 0 && (
                                <span className="text-[11px] text-muted-foreground">
                                  +{o.extraDurationMin}分
                                </span>
                              )}
                            </span>
                            <span className="font-medium tabular-nums">+{formatJpy(o.priceJpy)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* 選択サマリ（固定バー） */}
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <div className="container flex max-w-2xl items-center justify-between gap-3 py-3">
              <div className="min-w-0 text-sm">
                {selectedCount === 0 ? (
                  <span className="text-muted-foreground">メニューを選択してください</span>
                ) : (
                  <>
                    <div className="truncate font-medium">{menuSummary}</div>
                    <div className="text-xs text-muted-foreground">
                      約{totals.minutes}分 ・ <span className="font-semibold text-foreground">{formatJpy(totals.price)}</span>
                    </div>
                  </>
                )}
              </div>
              <Button
                data-testid="menu-next"
                disabled={selectedCount === 0}
                onClick={() => setStep('datetime')}
                className="shrink-0"
              >
                日時を選ぶ <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STEP: 日時 */}
      {step === 'datetime' && selectedCount > 0 && (
        <div className="grid gap-5">
          <div className="flex items-center justify-between gap-3">
            <BackButton onClick={() => setStep('service')} />
            <div className="truncate text-right text-xs text-muted-foreground">
              {menuSummary}（約{totals.minutes}分）
            </div>
          </div>

          {/* スタッフ選択 */}
          {requiresStaff && eligibleStaff.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-medium">担当者</div>
              <div className="flex flex-wrap gap-2">
                <StaffChip
                  active={staffId === null}
                  onClick={() => {
                    setStaffId(null);
                    setSlot(null); // 担当変更で空き枠が変わるため選択枠をクリア
                  }}
                  label="おまかせ"
                />
                {eligibleStaff.map((st) => (
                  <StaffChip
                    key={st.id}
                    active={staffId === st.id}
                    onClick={() => {
                      setStaffId(st.id);
                      setSlot(null);
                    }}
                    label={st.displayName ?? st.name}
                    feeJpy={st.nominationFeeJpy}
                  />
                ))}
              </div>
              {selectedCount > 1 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  ※ 複数メニューは同じ担当者が通しで施術します。
                </p>
              )}
            </div>
          )}

          {/* 月カレンダー（○空き / △残少 / ×満 / 休） */}
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            {/* 月ナビ */}
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="前の月"
                disabled={viewMonth <= minMonth}
                onClick={() => setViewMonth((v) => addMonths(v, -1))}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="size-5" />
              </button>
              <span className="text-base font-semibold tabular-nums">{monthLabel(viewMonth)}</span>
              <button
                type="button"
                aria-label="次の月"
                disabled={viewMonth >= maxMonth}
                onClick={() => setViewMonth((v) => addMonths(v, 1))}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>

            {/* 曜日ヘッダ */}
            <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">
              {WEEK_HEADER.map((w, i) => (
                <div key={w} className={cn('pb-1.5', i === 0 && 'text-red-500', i === 6 && 'text-blue-500')}>
                  {w}
                </div>
              ))}
            </div>

            {/* 日付セル */}
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map((d, idx) => {
                if (!d) return <div key={`b${idx}`} />;
                const info = describeIsoDate(d);
                const sel = d === date;
                const isToday = d === today;
                const isPast = d < today;
                const st = dateStatus[d];
                const unbookable = isPast || st === 'FULL' || st === 'CLOSED';
                const mark = !isPast && st ? DATE_MARK[st] : null;
                return (
                  <button
                    key={d}
                    type="button"
                    data-testid="day"
                    data-date={d}
                    data-status={st ?? ''}
                    disabled={unbookable}
                    onClick={() => {
                      setDate(d);
                      setSlot(null);
                    }}
                    className={cn(
                      'flex aspect-square flex-col items-center justify-center rounded-lg border text-sm transition-colors',
                      sel
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : unbookable
                          ? 'cursor-not-allowed border-transparent text-muted-foreground/40'
                          : 'border-transparent hover:border-primary hover:bg-accent',
                      !sel && isToday && !unbookable && 'ring-1 ring-primary/40',
                    )}
                  >
                    <span
                      className={cn(
                        'font-medium leading-none',
                        !sel && !unbookable && info.dow === 0 && 'text-red-600',
                        !sel && !unbookable && info.dow === 6 && 'text-blue-600',
                      )}
                    >
                      {info.day}
                    </span>
                    <span className={cn('mt-0.5 h-3 text-[11px] leading-none', !sel && mark?.cls)}>
                      {mark?.label ?? ''}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 凡例 */}
            <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
              <span><span className="font-medium text-green-600">○</span> 空き</span>
              <span><span className="font-medium text-amber-600">△</span> 残少</span>
              <span><span className="font-medium text-slate-400">×</span> 満</span>
              <span><span className="font-medium text-slate-400">休</span> 休業</span>
            </div>
          </div>

          {/* 時間スロット */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Clock className="size-4 text-primary" />
              {(() => {
                const di = describeIsoDate(date);
                return `${di.month}月${di.day}日(${di.weekday})の時間`;
              })()}
              {dayStatus !== 'OPEN' && dayStatus !== 'SPECIAL_OPEN' && (
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {DAY_STATUS_LABEL[dayStatus] ?? dayStatus}
                </span>
              )}
            </div>
            {loadingSlots ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : slots.length === 0 ? (
              <p className="rounded-lg bg-muted/50 py-8 text-center text-sm text-muted-foreground">
                {DAY_STATUS_LABEL[dayStatus] ?? 'この日は予約を受け付けていません。'}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {slots.map((sl) => {
                  const selected = slot?.startAt === sl.startAt;
                  return (
                    <button
                      key={sl.startAt}
                      data-testid="slot"
                      data-available={sl.available}
                      disabled={!sl.available}
                      onClick={() => setSlot(sl)}
                      className={cn(
                        'flex flex-col items-center rounded-lg border py-2.5 text-sm transition-colors',
                        selected && 'border-primary bg-primary text-primary-foreground shadow-sm',
                        !selected && sl.available && 'hover:border-primary hover:bg-accent',
                        !sl.available && 'cursor-not-allowed border-dashed bg-muted/30 text-muted-foreground/60',
                      )}
                    >
                      <span className="font-medium tabular-nums">{formatTimeInTz(sl.startAt, shop.timezone)}</span>
                      {!sl.available && (
                        <span className="text-[10px]">{SLOT_REASON_LABEL[sl.reason ?? ''] ?? '×'}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Button disabled={!slot} onClick={() => setStep('form')} className="w-full">
            次へ
          </Button>
        </div>
      )}

      {/* STEP: お客様情報 */}
      {step === 'form' && (
        <div className="grid gap-4">
          <BackButton onClick={() => setStep('datetime')} />
          {isLineMode ? (
            <div className="flex items-center gap-3 rounded-xl border border-[#06C755]/40 bg-[#06C755]/10 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#06C755] text-[11px] font-bold tracking-tight text-white">
                LINE
              </span>
              <div className="min-w-0 text-sm">
                <div className="font-semibold text-foreground">{form.name || lineProfile?.displayName} 様</div>
                <div className="text-xs text-muted-foreground">
                  LINE アカウントで予約します。ご予約確認・リマインドは LINE に届きます。
                </div>
              </div>
            </div>
          ) : (
            <>
              <Field label="お名前" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="山田 太郎" />
              </Field>
              <Field label="フリガナ">
                <Input value={form.nameKana} onChange={(e) => setForm({ ...form, nameKana: e.target.value })} placeholder="ヤマダ タロウ" />
              </Field>
              <Field label="メールアドレス">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="taro@example.com" />
              </Field>
            </>
          )}
          <Field label={isLineMode ? '電話番号（任意）' : '電話番号'}>
            <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="090-1234-5678" />
          </Field>
          <Field label="ご要望（任意）">
            <textarea
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          {!isLineMode && (
            <p className="text-xs text-muted-foreground">
              ※ メールアドレスまたは電話番号のいずれかは必須です。
            </p>
          )}
          <Button
            disabled={isLineMode ? !form.name : !form.name || (!form.email && !form.phone)}
            onClick={() => setStep('confirm')}
            className="w-full"
          >
            確認画面へ
          </Button>
        </div>
      )}

      {/* STEP: 確認（明細内訳つき） */}
      {step === 'confirm' && selectedCount > 0 && slot && (
        <div className="grid gap-4">
          <BackButton onClick={() => setStep('form')} />
          <Card>
            <CardContent className="grid gap-3 py-5 text-sm">
              <div className="flex items-center gap-2 text-base font-semibold">
                <MapPin className="size-4 text-primary" /> {shop.name}
              </div>

              {/* 明細 */}
              <div className="grid gap-1.5 rounded-lg bg-muted/40 p-3">
                {selectedServices.map((svc) => (
                  <div key={svc.id} className="grid gap-1">
                    {isOnSale(svc) ? (
                      <div className="flex justify-between gap-4">
                        <span className="shrink-0 text-muted-foreground">{svc.name}</span>
                        <span className="flex items-center gap-1.5 text-right font-medium">
                          <span className="text-xs text-muted-foreground line-through">{formatJpy(svc.priceJpy)}</span>
                          <span className="font-semibold text-rose-600">{formatJpy(effectivePrice(svc))}</span>
                        </span>
                      </div>
                    ) : (
                      <Row label={svc.name} value={formatJpy(svc.priceJpy)} />
                    )}
                    {optionsOf(svc).map((o) => (
                      <div key={o.id} className="flex justify-between gap-4 pl-4 text-xs text-muted-foreground">
                        <span>＋ {o.name}{o.extraDurationMin > 0 ? `（+${o.extraDurationMin}分）` : ''}</span>
                        <span className="tabular-nums">{formatJpy(o.priceJpy)}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {totals.nominationFee > 0 && (
                  <Row label={`指名料（${staffName(staffId)}）`} value={formatJpy(totals.nominationFee)} />
                )}
                <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-bold">
                  <span>合計</span>
                  <span className="tabular-nums">{formatJpy(totals.price)}</span>
                </div>
              </div>

              <Row label="担当" value={staffName(staffId)} />
              <Row label="日時" value={formatDateTimeInTz(slot.startAt, shop.timezone)} />
              <Row label="所要時間" value={`約${totals.minutes}分`} />
              <hr />
              <Row label="お名前" value={form.name} />
              {form.nameKana && <Row label="フリガナ" value={form.nameKana} />}
              {form.email && <Row label="メール" value={form.email} />}
              {form.phone && <Row label="電話" value={form.phone} />}
              {form.note && <Row label="ご要望" value={form.note} />}
            </CardContent>
          </Card>
          <Button data-testid="confirm" disabled={submitting} onClick={submit} className="w-full">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : 'この内容で予約する'}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" /> 戻る
    </button>
  );
}

function StaffChip({
  active,
  onClick,
  label,
  feeJpy = 0,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  feeJpy?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20'
          : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
      )}
    >
      <User className="size-3.5" /> {label}
      {feeJpy > 0 && (
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
            active ? 'bg-white/20' : 'bg-secondary text-secondary-foreground',
          )}
        >
          指名+{formatJpy(feeJpy)}
        </span>
      )}
    </button>
  );
}
