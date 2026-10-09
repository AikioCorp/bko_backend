import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
prisma.rssFeed.findMany({ include: { podcast: true } }).then(res => {
  console.log(res.map(r => r.podcast.name + " -> " + r.url));
  prisma.$disconnect();
});
