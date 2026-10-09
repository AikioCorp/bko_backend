import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const categories = await prisma.category.findMany({ select: { id: true, name: true, slug: true } });
  const podcasts = await prisma.podcast.findMany({ 
    select: { id: true, name: true }
  });
  console.log("CATEGORIES:\n" + JSON.stringify(categories, null, 2));
  console.log("ALL PODCASTS:\n" + JSON.stringify(podcasts, null, 2));
  await prisma.$disconnect();
}
main().catch(console.error);
