/**
 * Seeds 3 sites, 1 inspector, 1 supervisor and the default checklist template.
 * Idempotent: safe to run repeatedly. Passwords come from SEED_INSPECTOR_PASSWORD / SEED_SUPERVISOR_PASSWORD.
 */
import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const SEED_SITES = [
  {
    id: '6f1c2a4e-0b7d-4c1e-9a51-3d2f8e1b0a01',
    name: 'Harbor Logistics Warehouse',
    address: '12 Quay Road, Dock 4',
  },
  {
    id: '6f1c2a4e-0b7d-4c1e-9a51-3d2f8e1b0a02',
    name: 'Northgate Office Tower',
    address: '200 Northgate Avenue',
  },
  {
    id: '6f1c2a4e-0b7d-4c1e-9a51-3d2f8e1b0a03',
    name: 'Riverside Construction Site',
    address: 'Plot 7, Riverside Industrial Park',
  },
];

export const DEFAULT_TEMPLATE = {
  id: '9a0e7c55-6b1f-4d2a-8f3e-1c5b7d9e2f00',
  name: 'General site safety',
  items: [
    { id: 'exits', label: 'Emergency exits clear and signed' },
    { id: 'extinguishers', label: 'Fire extinguishers present and in date' },
    { id: 'first-aid', label: 'First aid kit stocked' },
    { id: 'ppe', label: 'PPE worn by everyone on site' },
    { id: 'electrical', label: 'Electrical panels closed and labelled' },
    { id: 'walkways', label: 'Walkways free of trip hazards' },
    { id: 'storage', label: 'Hazardous materials stored correctly' },
    { id: 'lighting', label: 'Lighting adequate in work areas' },
    { id: 'scaffolding', label: 'Scaffolding / ladders inspected and tagged' },
  ],
};

export const SEED_USERS: { email: string; name: string; role: Role; passwordEnv: string }[] = [
  {
    email: 'inspector@siteward.test',
    name: 'Ahmed',
    role: 'inspector',
    passwordEnv: 'SEED_INSPECTOR_PASSWORD',
  },
  {
    email: 'supervisor@siteward.test',
    name: 'Sam Supervisor',
    role: 'supervisor',
    passwordEnv: 'SEED_SUPERVISOR_PASSWORD',
  },
];

async function main() {
  for (const u of SEED_USERS) {
    const password = process.env[u.passwordEnv];
    if (!password || password.startsWith('choose-')) {
      throw new Error(`${u.passwordEnv} must be set to a real password (see backend/.env.example)`);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash },
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }
  for (const site of SEED_SITES) {
    await prisma.site.upsert({ where: { id: site.id }, update: site, create: site });
  }
  await prisma.checklistTemplate.upsert({
    where: { id: DEFAULT_TEMPLATE.id },
    update: { name: DEFAULT_TEMPLATE.name, items: DEFAULT_TEMPLATE.items, isDefault: true },
    create: { ...DEFAULT_TEMPLATE, isDefault: true },
  });
  console.log(
    `Seeded ${SEED_USERS.length} users, ${SEED_SITES.length} sites, 1 checklist template.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
