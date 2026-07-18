/**
 * 公開 API（route handlers）の HTTP 入口層 集成テスト（実DB）。
 * Zod 検証・エラー応答(400/404)・正常応答(200/201) を route() 経由で検証。
 * now を注入できないため、実時刻基準で受付期間内の近日(+7日)を使う。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { GET as shopGET } from '@/app/api/public/shops/[slug]/route';
import { GET as availabilityGET } from '@/app/api/public/shops/[slug]/availability/route';
import { POST as bookingPOST } from '@/app/api/public/shops/[slug]/bookings/route';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
let slug = '';
let serviceId = '';
const date = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

beforeAll(async () => {
  const sc = await seedScenario({ staffCount: 2, staffCapacity: 1, bookingWindowDays: 90 });
  createdTenants.push(sc.tenantId);
  serviceId = sc.serviceId;
  const shop = await prisma.shop.findUnique({ where: { id: sc.shopId }, select: { slug: true } });
  slug = shop!.slug;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

const reqGet = (url: string) => new NextRequest(`http://localhost${url}`);
const reqPost = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /api/public/shops/[slug]', () => {
  it('公開店舗を返す（200）', async () => {
    const res = await shopGET(reqGet(`/api/public/shops/${slug}`), { params: { slug } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.shop.slug).toBe(slug);
    expect(json.shop.services.length).toBeGreaterThan(0);
  });

  it('存在しない店舗は 404', async () => {
    const res = await shopGET(reqGet('/api/public/shops/no-such'), { params: { slug: 'no-such' } });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });
});

describe('GET availability', () => {
  it('正常クエリで slots を返す（200）', async () => {
    const res = await availabilityGET(
      reqGet(`/api/public/shops/${slug}/availability?serviceId=${serviceId}&date=${date}`),
      { params: { slug } },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.slots)).toBe(true);
    expect(json.slots.some((s: { available: boolean }) => s.available)).toBe(true);
  });

  it('serviceId 欠如は 400（Zod）', async () => {
    const res = await availabilityGET(
      reqGet(`/api/public/shops/${slug}/availability?date=${date}`),
      { params: { slug } },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('日付形式不正は 400', async () => {
    const res = await availabilityGET(
      reqGet(`/api/public/shops/${slug}/availability?serviceId=${serviceId}&date=2026/01/01`),
      { params: { slug } },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST booking', () => {
  it('連絡先なしは 400（refine）', async () => {
    const res = await bookingPOST(
      reqPost(`/api/public/shops/${slug}/bookings`, {
        serviceId,
        startAt: new Date(`${date}T01:00:00.000Z`).toISOString(),
        customer: { name: '太郎' },
      }),
      { params: { slug } },
    );
    expect(res.status).toBe(400);
  });

  it('正常予約は 201', async () => {
    // 空き枠を取得
    const av = await availabilityGET(
      reqGet(`/api/public/shops/${slug}/availability?serviceId=${serviceId}&date=${date}`),
      { params: { slug } },
    );
    const slots = (await av.json()).slots as { startAt: string; available: boolean }[];
    const slot = slots.find((s) => s.available)!;

    const res = await bookingPOST(
      reqPost(`/api/public/shops/${slug}/bookings`, {
        serviceId,
        staffId: null,
        startAt: slot.startAt,
        customer: { name: 'API 太郎', email: 'api@test.com' },
      }),
      { params: { slug } },
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.booking.status).toBe('CONFIRMED');
    expect(json.booking.cancellationToken).toBeTruthy();
  });
});
