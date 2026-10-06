const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.role.findFirst({
  where: { name: 'SUPER_ADMIN' }
}).then(console.log).catch(console.error).finally(() => prisma.$disconnect());
