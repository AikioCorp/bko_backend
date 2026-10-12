import { prisma } from "./src/config/prisma.js";

async function checkAfropod() {
  const afropod = await prisma.podcast.findMany({
    where: {
      name: { contains: "Afropod", mode: "insensitive" }
    },
    include: {
      categories: { include: { category: true } },
      rssFeed: true,
      _count: { select: { episodes: true } }
    }
  });

  console.log("AFROPOD IN DB:", JSON.stringify(afropod, null, 2));
  await prisma.$disconnect();
}

checkAfropod().catch(console.error);
