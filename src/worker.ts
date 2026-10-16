import { MediaWorkerService } from "./modules/media/media-worker.service.js";
import { EpisodePublisherWorkerService } from "./modules/episodes/episode-publisher-worker.service.js";
import { EmailWorkerService } from "./modules/notifications/email-worker.service.js";
import { PushWorkerService } from "./modules/notifications/push-worker.service.js";
import { RssWorkerService } from "./modules/rss/rss-worker.service.js";
import { YouTubeWorkerService } from "./modules/youtube/youtube-worker.service.js";
import { TranscriptWorkerService } from "./modules/transcripts/transcript-worker.service.js";

import { EmbeddingWorkerService } from "./modules/recommendations/embedding-worker.service.js";

import fs from "fs";
import os from "os";
import path from "path";

let isWorkerRunning = false;
const defaultHeartbeat = path.join(os.tmpdir(), "worker-heartbeat");
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE || defaultHeartbeat;

function touchHeartbeat() {
  try {
    fs.writeFileSync(
      HEARTBEAT_FILE,
      JSON.stringify({
        timestamp: Date.now(),
        pid: process.pid,
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
  } catch {
    // Ne pas interrompre le worker si l'écriture du heartbeat échoue temporairement
  }
}

export async function runWorkerLoop() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  console.log("🚀 Background Media, RSS, Embeddings & Transcript Worker démarré...");
  touchHeartbeat();

  while (true) {
    try {
      touchHeartbeat();
      const mediaProcessed = await MediaWorkerService.processNextJob();
      await RssWorkerService.scheduleAutoSyncs();
      const rssProcessed = await RssWorkerService.processNextJob();
      await YouTubeWorkerService.scheduleAutoSyncs();
      const youtubeProcessed = await YouTubeWorkerService.processNextJob();
      const transcriptProcessed = await TranscriptWorkerService.processNextJob();
      const publishProcessed = await EpisodePublisherWorkerService.processNextJob();
      const emailProcessed = await EmailWorkerService.processNextJob();
      const pushProcessed = await PushWorkerService.processNextJob();
      const embeddingProcessed = await EmbeddingWorkerService.processPendingEmbeddings();

      touchHeartbeat();

      if (!mediaProcessed && !rssProcessed && !youtubeProcessed && !transcriptProcessed && !publishProcessed && !emailProcessed && !pushProcessed && !embeddingProcessed) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error("Erreur worker:", error);
      touchHeartbeat();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

export function startEmbeddedWorker() {
  // Démarre la boucle worker en tâche de fond dans le processus principal sans bloquer le serveur HTTP
  void runWorkerLoop();
}

// Si lancé directement en CLI (ex: `npm run worker` ou `node dist/worker.js`)
if (process.argv[1] && (process.argv[1].endsWith("worker.js") || process.argv[1].endsWith("worker.ts"))) {
  runWorkerLoop();
}
