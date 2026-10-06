import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const perm = await prisma.permission.upsert({
    where: { code: 'catalog.delete' },
    update: {},
    create: {
      code: 'catalog.delete',
      description: 'Delete languages and categories',
    }
  });
  
  const superAdminRole = await prisma.role.findFirst({
    where: { name: 'SUPER_ADMIN' }
  });
  
  if (superAdminRole) {
    const exists = await prisma.rolePermission.findFirst({
      where: { roleId: superAdminRole.id, permissionId: perm.id }
    });
    if (!exists) {
      await prisma.rolePermission.create({
        data: { roleId: superAdminRole.id, permissionId: perm.id }
      });
      console.log('Granted catalog.delete to SUPER_ADMIN');
    } else {
      console.log('SUPER_ADMIN already has catalog.delete');
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
