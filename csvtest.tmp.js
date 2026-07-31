const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const T = 'cmr7cjga20019y8qnb5itona8', S = 'cmr7cjga2001by8qnknw1nfn9';
  const svc = await p.service.findFirst({ where: { shopId: S, deletedAt: null }, select: { id: true } });
  const c = await p.customer.upsert({
    where: { id: 'csv-inject-test' }, update: {},
    create: { id: 'csv-inject-test', tenantId: T, shopId: S, name: 'x' },
  });
  await p.bookingItem.deleteMany({ where: { booking: { customerId: c.id } } });
  await p.booking.deleteMany({ where: { customerId: c.id } });
  const start = new Date('2026-07-15T02:00:00.000Z');
  await p.booking.create({
    data: {
      tenantId: T, shopId: S, customerId: c.id, serviceId: svc.id,
      startAt: start, endAt: new Date(start.getTime() + 3600000),
      status: 'CONFIRMED', totalPriceJpy: 1000, source: 'PUBLIC',
      customerName: '=HYPERLINK("http://evil.example","給与明細")',
      customerEmail: 'a,b"c@test.com',
      customerPhone: '+81-90-0000-0000',
    },
  });
  console.log('seeded');
  await p.$disconnect();
})();
