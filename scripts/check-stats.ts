import { prisma } from "../src/config/prisma.js";

async function main() {
  const totalPodcasts = await prisma.podcast.count();
  const totalEpisodes = await prisma.episode.count();
  
  const zeroEpisodePodcasts = await prisma.podcast.findMany({
    where: {
      episodes: {
        none: {}
      }
    },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true
    }
  });

  const podcastsByLang = await prisma.podcast.groupBy({
    by: ['primaryLanguageCode'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } }
  });

  const podcastsByCountry = await prisma.podcast.groupBy({
    by: ['countryId'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } }
  });

  console.log(`\n========================================`);
  console.log(`📈 STATISTIQUES GLOBALES DE LA PLATEFORME`);
  console.log(`========================================`);
  console.log(`Total Podcasts : ${totalPodcasts}`);
  console.log(`Total Épisodes : ${totalEpisodes}`);
  console.log(`Podcasts sans épisode : ${zeroEpisodePodcasts.length}`);
  if (zeroEpisodePodcasts.length > 0) {
    console.log("Liste sans épisode :", zeroEpisodePodcasts.map(p => p.name).join(", "));
  }

  console.log(`\n🌍 RÉPARTITION PAR LANGUE :`);
  for (const l of podcastsByLang) {
    console.log(`- ${l.primaryLanguageCode}: ${l._count.id} émissions`);
  }

  console.log(`\n📍 RÉPARTITION PAR PAYS :`);
  for (const c of podcastsByCountry) {
    console.log(`- ${c.countryId}: ${c._count.id} émissions`);
  }
  console.log(`========================================\n`);

  await prisma.$disconnect();
}

main().catch(console.error);
