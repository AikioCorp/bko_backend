const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 
async function run() { 
  const pods = await prisma.podcast.findMany({ include: { rssFeed: true } }); 
  console.log('Podcasts:', pods.map(p => p.name + ' (RSS: ' + !!p.rssFeed + ')').join('\n')); 
} 
run().catch(console.error).finally(() => prisma.$disconnect());
