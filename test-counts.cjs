const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.podcastCategory.count().then(c => console.log('PodcastCategory count:', c)).catch(console.error).finally(() => prisma.$disconnect());
