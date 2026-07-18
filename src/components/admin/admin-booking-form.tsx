'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, Select, TextArea, FormError } from './form-kit';
import { adminAvailabilityAction, adminCreateBookingAction, type AdminSlot } from '@/server/actions/booking-actions';
import { SLOT_REASON_LABEL, DAY_STATUS_LABEL, formatTimeInTz } from '@/lib/booking-display';
import { cn } from '@/lib/utils';
import { todayInZone } from '@/lib/time';

interface Service { id: string; name: string; requiresStaff: boolean; staffIds: string[] }
interface Staff { id: string; name: string }

export function AdminBookingForm({
  shopId,
  timezone,
  services,
  staff,
}: {
  shopId: string;
  timezone: string;
  services: Service[];
  staff: Staff[];
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(() => todayInZone(timezone));
  const [slots, setSlots] = useState<AdminSlot[]>([]);
  const [dayStatus, setDayStatus] = useState('');
  const [startAt, setStartAt] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const service = services.find((s) => s.id === serviceId);
  const eligibleStaff = service ? staff.filter((s) => service.staffIds.includes(s.id)) : [];

  const loadSlots = async () => {
    if (!serviceId) { setError('メニューを選択してください。'); return; }
    setError(null);
    setLoadingSlots(true);
    setStartAt('');
    const res = await adminAvailabilityAction(shopId, serviceId, staffId || null, date);
    setLoadingSlots(false);
    if (!res.ok) { setError(res.error); setSlots([]); return; }
    setSlots(res.data!.slots);
    setDayStatus(res.data!.dayStatus);
  };

  const submit = async () => {
    if (!serviceId || !startAt) { setError('メニューと時間枠を選択してください。'); return; }
    if (!form.name) { setError('お客様名を入力してください。'); return; }
    setError(null);
    setSubmitting(true);
    const res = await adminCreateBookingAction(shopId, {
      serviceId,
      staffId: staffId || null,
      startAt,
      customer: { name: form.name, phone: form.phone || undefined, email: form.email || undefined },
      note: form.note || undefined,
    });
    setSubmitting(false);
    if (!res.ok) { setError(res.error); return; }
    router.push(`/admin/bookings/${res.data!.bookingId}`);
    router.refresh();
  };

  return (
    <div className="grid max-w-2xl gap-4">
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="メニュー" required>
          <Select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setStaffId(''); setSlots([]); setStartAt(''); }}>
            <option value="">選択してください</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="担当">
          <Select value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlots([]); setStartAt(''); }} disabled={!service?.requiresStaff}>
            <option value="">おまかせ</option>
            {eligibleStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex items-end gap-3">
        <Field label="日付" required>
          <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlots([]); setStartAt(''); }} />
        </Field>
        <Button type="button" variant="outline" onClick={loadSlots} disabled={loadingSlots}>
          {loadingSlots ? <Loader2 className="size-4 animate-spin" /> : '空き枠を表示'}
        </Button>
      </div>

      {slots.length > 0 ? (
        <Field label="時間枠" required>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.map((sl) => {
              const selected = startAt === sl.startAt;
              return (
                <button
                  key={sl.startAt}
                  type="button"
                  data-testid="admin-slot"
                  data-available={sl.available}
                  disabled={!sl.available}
                  onClick={() => setStartAt(sl.startAt)}
                  className={cn(
                    'flex flex-col items-center rounded-lg border py-2 text-sm',
                    selected && 'border-primary bg-primary text-primary-foreground',
                    !selected && sl.available && 'hover:border-primary',
                    !sl.available && 'cursor-not-allowed border-dashed bg-muted/40 text-muted-foreground',
                  )}
                >
                  <span className="font-medium">{formatTimeInTz(sl.startAt, timezone)}</span>
                  {!sl.available && <span className="text-[10px]">{SLOT_REASON_LABEL[sl.reason ?? ''] ?? '×'}</span>}
                </button>
              );
            })}
          </div>
        </Field>
      ) : dayStatus && dayStatus !== 'OPEN' && dayStatus !== 'SPECIAL_OPEN' ? (
        <p className="rounded-md bg-muted/50 py-4 text-center text-sm text-muted-foreground">
          {DAY_STATUS_LABEL[dayStatus] ?? '予約を受け付けていません。'}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="お客様名" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="山田 太郎" />
        </Field>
        <Field label="電話">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      <Field label="メール">
        <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="メモ">
        <TextArea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </Field>

      <div>
        <Button type="button" onClick={submit} disabled={submitting || !startAt}>
          {submitting && <Loader2 className="size-4 animate-spin" />} 予約を登録
        </Button>
      </div>
    </div>
  );
}
