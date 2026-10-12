import { prisma } from "./src/config/prisma.js";

async function showAllPodcasts() {
  const podcasts = await prisma.podcast.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      primaryLanguageCode: true,
      countryId: true,
      status: true,
      _count: {
        select: { episodes: true }
      }
    }
  });

  console.log(`TOTAL PODCASTS IN DB: ${podcasts.length}`);
  for (const p of podcasts) {
    console.log(`- [${p.primaryLanguageCode}] [${p.countryId}] ${p.name} -> ${p._count.episodes} épisodes (Status: ${p.status})`);
  }
  await prisma.$disconnect();
}

showAllPodcasts().catch(console.error);
