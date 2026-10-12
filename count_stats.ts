import { prisma } from "./src/config/prisma.js";

async function countStats() {
  const pendingJobs = await prisma.jobQueueItem.count({ where: { status: "PENDING" } });
  const processingJobs = await prisma.jobQueueItem.count({ where: { status: "PROCESSING" } });
  const completedJobs = await prisma.jobQueueItem.count({ where: { status: "COMPLETED" } });
  const totalEpisodes = await prisma.episode.count();

  console.log(`STATUS: Pending=${pendingJobs}, Processing=${processingJobs}, Completed=${completedJobs}, TotalEpisodes=${totalEpisodes}`);
  await prisma.$disconnect();
}

countStats().catch(console.error);
