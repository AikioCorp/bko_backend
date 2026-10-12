import { prisma } from "./src/config/prisma.js";

async function checkRecentPodcasts() {
  const podcasts = await prisma.podcast.findMany({
    where: {
      name: {
        in: [
          "Tea With Tay Podcast",
          "The Mali Empire: The Richest Civilization in History — Fexingo History",
          "The Flip",
          "Afrobeats Intelligence",
          "I Said What I Said",
          "GuineeCheck",
          "The Sahel Untold",
          "Basic Bambara",
          "Le Grand Forum - #LGF",
          "Afrique Sante",
          "Transfert",
          "InPower par Louise Aubery",
          "Culture 2000",
          "Afrotopiques",
          "Les Femmes Capables"
        ]
      }
    },
    select: {
      name: true,
      _count: {
        select: { episodes: true }
      }
    }
  });

  console.log("EPISODE COUNTS FOR SCREENSHOT PODCASTS:");
  for (const p of podcasts) {
    console.log(`- ${p.name}: ${p._count.episodes} épisodes`);
  }
  await prisma.$disconnect();
}

checkRecentPodcasts().catch(console.error);
