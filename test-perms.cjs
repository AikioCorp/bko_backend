const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.rolePermission.findMany({
  where: { role: { name: 'SUPER_ADMIN' } },
  include: { permission: true }
}).then(perms => console.log(perms.map(p => p.permission.action))).catch(console.error).finally(() => prisma.$disconnect());
