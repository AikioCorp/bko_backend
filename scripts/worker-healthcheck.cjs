const fs = require("fs");
const os = require("os");
const path = require("path");

const defaultHeartbeat = path.join(os.tmpdir(), "worker-heartbeat");
const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE || defaultHeartbeat;
const MAX_STALE_MS = parseInt(process.env.WORKER_HEARTBEAT_MAX_AGE_MS || "60000", 10);

try {
  if (!fs.existsSync(HEARTBEAT_FILE)) {
    console.error(`[Healthcheck] Fichier heartbeat introuvable : ${HEARTBEAT_FILE}`);
    process.exit(1);
  }

  const stat = fs.statSync(HEARTBEAT_FILE);
  const ageMs = Date.now() - stat.mtimeMs;

  if (ageMs > MAX_STALE_MS) {
    console.error(
      `[Healthcheck] Pulsation worker trop ancienne (${Math.round(ageMs / 1000)}s > seuil ${Math.round(MAX_STALE_MS / 1000)}s) : ${HEARTBEAT_FILE}`
    );
    process.exit(1);
  }

  process.exit(0);
} catch (error) {
  console.error(`[Healthcheck] Erreur lors de la lecture du heartbeat :`, error);
  process.exit(1);
}
