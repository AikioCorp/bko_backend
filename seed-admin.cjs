const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const adminRole = await prisma.role.findFirst({ where: { name: 'SUPER_ADMIN' }});
  if (adminRole) {
    const allPerms = await prisma.permission.findMany();
    for (const p of allPerms) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
        create: { roleId: adminRole.id, permissionId: p.id },
        update: {}
      });
    }
    console.log('Seeded SUPER_ADMIN with', allPerms.length, 'permissions');
  }
}
run().catch(console.error).finally(() => prisma.$disconnect());
