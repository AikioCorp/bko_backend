import { MediaWorkerService } from "./modules/media/media-worker.service.js";
import { EpisodePublisherWorkerService } from "./modules/episodes/episode-publisher-worker.service.js";
import { EmailWorkerService } from "./modules/notifications/email-worker.service.js";
import { RssWorkerService } from "./modules/rss/rss-worker.service.js";
import { TranscriptWorkerService } from "./modules/transcripts/transcript-worker.service.js";

let isWorkerRunning = false;

export async function runWorkerLoop() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  console.log("🚀 Background Media, RSS & Transcript Worker démarré...");

  while (true) {
    try {
      const mediaProcessed = await MediaWorkerService.processNextJob();
      await RssWorkerService.scheduleAutoSyncs();
      const rssProcessed = await RssWorkerService.processNextJob();
      const transcriptProcessed = await TranscriptWorkerService.processNextJob();
      const publishProcessed = await EpisodePublisherWorkerService.processNextJob();
      const emailProcessed = await EmailWorkerService.processNextJob();

      if (!mediaProcessed && !rssProcessed && !transcriptProcessed && !publishProcessed && !emailProcessed) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error("Erreur worker:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function startEmbeddedWorker() {
  // Démarre la boucle worker en tâche de fond dans le processus principal sans bloquer le serveur HTTP
  void runWorkerLoop();
}

// Si lancé directement en CLI (ex: `npm run worker` ou `node dist/worker.js`)
if (process.argv[1] && process.argv[1].endsWith("worker.js")) {
  runWorkerLoop();
}
