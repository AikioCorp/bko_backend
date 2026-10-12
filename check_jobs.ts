import { prisma } from "./src/config/prisma.js";

async function checkJobs() {
  const jobs = await prisma.jobQueueItem.findMany({
    orderBy: { createdAt: "desc" },
    take: 20
  });
  console.log("LAST 20 JOBS:", JSON.stringify(jobs, null, 2));

  const feeds = await prisma.rssFeed.findMany({
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true,
      url: true,
      syncStatus: true,
      lastSyncAt: true,
      errorMessage: true,
      podcast: {
        select: {
          id: true,
          name: true,
          _count: {
            select: { episodes: true }
          }
        }
      }
    }
  });
  console.log("LAST 15 FEEDS:", JSON.stringify(feeds, null, 2));

  await prisma.$disconnect();
}

checkJobs().catch(console.error);
