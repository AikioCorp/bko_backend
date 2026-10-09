import { startEmbeddedWorker } from "./worker.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import routesV1 from "./routes/v1/index.js";
import { PermissionService } from "./services/permission.service.js";

dotenv.config();

(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

const app = express();
const PORT = process.env.PORT || 8080;

// Derrière un reverse-proxy / CDN (Netlify, Vercel, nginx...), faire confiance au
// premier proxy pour que req.ip reflète l'IP réelle du client — sinon le rate-limiting
// se base sur l'IP du proxy et devient inefficace / contournable via X-Forwarded-For.
app.set("trust proxy", 1);

// Security headers with Helmet
app.use(helmet());
app.use(cookieParser());

// Strict CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:3001,https://bamakopodcast.studio")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(new Error("CORS_POLICY_RESTRICTION: Origine non autorisée par Bamako Podcast"));
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));

// Global Rate Limiting (1000 requêtes par 15 minutes par IP en production)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "production" ? 1000 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Trop de requêtes soumises. Veuillez réessayer dans quelques minutes.",
    },
  },
});

// Root endpoint (Pour tests d'accès rapide & Coolify default)
app.get("/", (req: express.Request, res: express.Response) => {
  res.status(200).json({ name: "Bamako Podcast API", status: "ok", version: "1.0.0" });
});

// Healthcheck endpoint (Pour Coolify / Docker / Reverse Proxies)
app.get("/health", (req: express.Request, res: express.Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/v1", limiter, routesV1);

// Error Handling fallback
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // On journalise le détail complet côté serveur...
  console.error("Unhandled Error:", err.message || err);

  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === "production";

  // ...mais on n'expose au client un message brut que pour les erreurs "attendues"
  // (4xx). Pour une 5xx en production, on renvoie un message générique afin de ne pas
  // divulguer de détails internes (Prisma, stack, etc.).
  const message =
    status < 500 ? err.message || "Requête invalide." : isProd ? "Une erreur inattendue est survenue." : err.message;

  res.status(status).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_SERVER_ERROR",
      message,
    },
  });
});

if (process.env.NODE_ENV !== "test") {
  // Synchronise le catalogue de permissions et les rôles système (idempotent).
  PermissionService.bootstrap().catch((e) => console.error("RBAC bootstrap impossible (migration appliquée ?) :", e.message));
  app.listen(PORT, () => {
    console.log(`🚀 Serveur Bko_backend démarré sur http://localhost:${PORT}`);
    // Démarre automatiquement le traitement asynchrone des files de tâches (RSS, médias, etc.)
    // startEmbeddedWorker();
  });
}

export default app;
