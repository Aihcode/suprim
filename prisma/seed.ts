/**
 * Seed idempotente de PrintFlow ERP.
 *   npm run db:seed   (tsx prisma/seed.ts)
 * Crea usuarios demo, estación PC-01 con JWT de 1 año, impresoras, tarifas,
 * reglas de descuento y una orden PAID de ejemplo con su pago.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

import { saveEncryptedFile } from '../src/lib/encryption';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-station-secret';

const TARIFFS = [
  { paperSize: 'A4', color: false, duplex: false, pricePerPage: 0.05 },
  { paperSize: 'A4', color: false, duplex: true, pricePerPage: 0.08 },
  { paperSize: 'A4', color: true, duplex: false, pricePerPage: 0.15 },
  { paperSize: 'A4', color: true, duplex: true, pricePerPage: 0.24 },
  { paperSize: 'LETTER', color: false, duplex: false, pricePerPage: 0.06 },
  { paperSize: 'LETTER', color: false, duplex: true, pricePerPage: 0.09 },
  { paperSize: 'LETTER', color: true, duplex: false, pricePerPage: 0.17 },
  { paperSize: 'LETTER', color: true, duplex: true, pricePerPage: 0.27 },
];

const RULES = [
  { id: 'rule-pct-50', name: '10% desde 50 páginas', type: 'PERCENTAGE', threshold: 50, value: 10 },
  { id: 'rule-pct-200', name: '15% desde 200 páginas', type: 'PERCENTAGE', threshold: 200, value: 15 },
  { id: 'rule-fixed-20', name: '$2.00 desde 20 páginas', type: 'FIXED', threshold: 20, value: 2 },
  { id: 'rule-free-100', name: '5 páginas gratis desde 100', type: 'FREE_PAGES', threshold: 100, value: 5 },
];

const PRINTERS = [
  {
    id: 'printer-hp-local',
    name: 'HP LaserJet Pro M404',
    type: 'LOCAL',
    ip: null,
    port: null,
    protocol: null,
    capabilities: { color: false, duplex: true, trays: ['T1', 'T2'], paper_sizes: ['A4', 'LETTER'] },
    status: 'ONLINE',
  },
  {
    id: 'printer-brother-ipp',
    name: 'Brother MFC-L8900 (IPP)',
    type: 'NETWORK',
    ip: '192.168.1.50',
    port: 631,
    protocol: 'IPP',
    capabilities: { color: false, duplex: true, trays: ['T1', 'T2', 'T3'], paper_sizes: ['A4', 'LETTER'] },
    status: 'ONLINE',
  },
  {
    id: 'printer-xerox-raw',
    name: 'Xerox Phaser (RAW 9100)',
    type: 'NETWORK',
    ip: '192.168.1.51',
    port: 9100,
    protocol: 'RAW',
    capabilities: { color: true, duplex: false, trays: ['T1'], paper_sizes: ['A4', 'LETTER'] },
    status: 'OFFLINE',
  },
];

async function main() {
  console.log('→ Sembrando base de datos...');

  const [admin, employee, client] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@printflow.local' },
      update: { role: 'ADMIN', name: 'Administrador' },
      create: { email: 'admin@printflow.local', name: 'Administrador', role: 'ADMIN', password: '', freePages: 0 },
    }),
    prisma.user.upsert({
      where: { email: 'employee@printflow.local' },
      update: { role: 'EMPLOYEE', name: 'Empleado' },
      create: { email: 'employee@printflow.local', name: 'Empleado', role: 'EMPLOYEE', password: '', freePages: 0 },
    }),
    prisma.user.upsert({
      where: { email: 'client@printflow.local' },
      update: { role: 'CLIENT', name: 'Cliente Demo', freePages: 10 },
      create: { email: 'client@printflow.local', name: 'Cliente Demo', role: 'CLIENT', password: '', freePages: 10 },
    }),
  ]);

  // Las contraseñas se hashean siempre (también en re-ejecuciones del seed).
  const passwords = [
    { id: admin.id, plain: 'Admin123!' },
    { id: employee.id, plain: 'Employee123!' },
    { id: client.id, plain: 'Client123!' },
  ];
  for (const item of passwords) {
    await prisma.user.update({
      where: { id: item.id },
      data: { password: await bcrypt.hash(item.plain, 12) },
    });
  }

  const stationId = 'station-pc-01';
  const stationToken = jwt.sign(
    { stationId, sub: stationId, type: 'station' },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '365d' },
  );
  await prisma.station.upsert({
    where: { id: stationId },
    update: { name: 'PC-01', token: stationToken, computerName: 'IMPRENTA-PC-01', os: 'WINDOWS', active: true },
    create: {
      id: stationId,
      name: 'PC-01',
      token: stationToken,
      computerName: 'IMPRENTA-PC-01',
      os: 'WINDOWS',
      active: true,
    },
  });

  for (const printer of PRINTERS) {
    await prisma.printer.upsert({
      where: { id: printer.id },
      update: { ...printer, capabilities: JSON.stringify(printer.capabilities) },
      create: { ...printer, capabilities: JSON.stringify(printer.capabilities), stationId },
    });
  }

  for (const tariff of TARIFFS) {
    await prisma.tariff.upsert({
      where: {
        paperSize_color_duplex: {
          paperSize: tariff.paperSize,
          color: tariff.color,
          duplex: tariff.duplex,
        },
      },
      update: { pricePerPage: tariff.pricePerPage, active: true },
      create: { ...tariff, active: true },
    });
  }

  for (const rule of RULES) {
    await prisma.discountRule.upsert({
      where: { id: rule.id },
      update: { ...rule, active: true },
      create: { ...rule, active: true },
    });
  }

  const demoOrderId = 'order-demo-paid';
  if (!(await prisma.order.findUnique({ where: { id: demoOrderId } }))) {
    const sample = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\n2 0 obj<</Type /Pages /Count 3>>endobj\n' +
        '3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>>endobj\n' +
        '4 0 obj<</Type /Page /Parent 2 0 R>>endobj\n5 0 obj<</Type /Page /Parent 2 0 R>>endobj\n%%EOF\n',
      'utf8',
    );
    const stored = saveEncryptedFile(sample, 'ejemplo.pdf');
    await prisma.order.create({
      data: {
        id: demoOrderId,
        userId: client.id,
        fileName: 'ejemplo.pdf',
        filePath: stored.filePath,
        fileKey: stored.fileKey,
        pages: 3,
        copies: 1,
        color: false,
        duplex: false,
        paperSize: 'A4',
        basePrice: 0.15,
        totalPrice: 0.15,
        discount: 0,
        freePages: 0,
        status: 'PAID',
        paymentProvider: 'DEMO',
        paymentId: 'demo_order-demo-paid',
        stationId,
        printerId: 'printer-hp-local',
      },
    });
    await prisma.payment.upsert({
      where: { providerId: 'demo_order-demo-paid' },
      update: {},
      create: {
        orderId: demoOrderId,
        provider: 'DEMO',
        providerId: 'demo_order-demo-paid',
        amount: 0.15,
        status: 'COMPLETED',
        webhookData: JSON.stringify({ mode: 'seed' }),
      },
    });
  }

  console.log('\n✅ Seed completado. Credenciales de prueba:');
  console.log('   ADMIN     admin@printflow.local     / Admin123!');
  console.log('   EMPLOYEE  employee@printflow.local  / Employee123!');
  console.log('   CLIENT    client@printflow.local    / Client123!  (10 páginas gratis)');
  console.log('\n   Estación PC-01 (station-pc-01), equipo IMPRENTA-PC-01, OS WINDOWS');
  console.log(`   Station token (JWT 1 año): ${stationToken}\n`);
}

main()
  .catch((error) => {
    console.error('❌ Error en seed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
