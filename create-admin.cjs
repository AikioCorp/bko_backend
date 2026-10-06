const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt'); // it was bcrypt before but let's use bcrypt

const prisma = new PrismaClient();
async function run() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const user = await prisma.user.upsert({
    where: { email: 'admin@bamako.ml' },
    update: { passwordHash: hashedPassword },
    create: {
      email: 'admin@bamako.ml',
      passwordHash: hashedPassword,
      fullName: 'Admin Bamako Podcast',
      isVerified: true
    }
  });

  const adminRole = await prisma.role.findFirst({ where: { name: 'SUPER_ADMIN' }});
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      create: { userId: user.id, roleId: adminRole.id },
      update: {}
    });
  }

  console.log('Admin user created/updated with id:', user.id);
}
run().catch(console.error).finally(() => prisma.$disconnect());
