const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.user.findFirst({ where: { email: 'admin@bamako.ml' } }).then(console.log).catch(console.error).finally(() => prisma.$disconnect());
