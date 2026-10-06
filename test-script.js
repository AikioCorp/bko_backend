import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.podcast.updateMany({ data: { isOfficial: false } }).then(() => console.log('Reset complete')).finally(() => prisma.$disconnect());
