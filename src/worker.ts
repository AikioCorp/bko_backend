import { MediaWorkerService } from "./modules/media/media-worker.service.js";
import { RssWorkerService } from "./modules/rss/rss-worker.service.js";
import { TranscriptWorkerService } from "./modules/transcripts/transcript-worker.service.js";

async function runWorkerLoop() {
  console.log("🚀 Background Media, RSS & Transcript Worker démarré...");

  while (true) {
    try {
      const mediaProcessed = await MediaWorkerService.processNextJob();
      const rssProcessed = await RssWorkerService.processNextJob();
      const transcriptProcessed = await TranscriptWorkerService.processNextJob();

      if (!mediaProcessed && !rssProcessed && !transcriptProcessed) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error("Erreur worker:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

runWorkerLoop();
