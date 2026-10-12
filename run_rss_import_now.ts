import { RssWorkerService } from "./src/modules/rss/rss-worker.service.js";
import { prisma } from "./src/config/prisma.js";

async function processAll() {
  console.log("⚡ Démarrage du traitement forcé de tous les flux RSS en attente...");
  let count = 0;
  while (true) {
    const processed = await RssWorkerService.processNextJob();
    if (!processed) {
      console.log("Fin des tâches en attente.");
      break;
    }
    count++;
    console.log(`✅ Tâche RSS #${count} traitée avec succès.`);
  }

  // Vérifier le nombre d'épisodes par podcast
  const podcasts = await prisma.podcast.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      name: true,
      _count: {
        select: { episodes: true }
      }
    }
  });

  console.log("\n📊 RÉSULTAT ÉPISODES IMPORTÉS :");
  for (const p of podcasts) {
    console.log(`- ${p.name}: ${p._count.episodes} épisodes`);
  }

  await prisma.$disconnect();
}

processAll().catch(console.error);
