const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.category.findMany({
  orderBy: { name: 'asc' },
  include: {
    _count: {
      select: { podcasts: true }
    }
  }
}).then(res => console.log("SUCCESS")).catch(console.error).finally(() => prisma.$disconnect());
