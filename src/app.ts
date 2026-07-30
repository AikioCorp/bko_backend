import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import routesV1 from "./routes/v1/index.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Security headers with Helmet
app.use(helmet());

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

app.use("/api/v1", limiter, routesV1);

// Error Handling fallback
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled Error:", err.message || err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || "INTERNAL_SERVER_ERROR",
      message: err.message || "Une erreur inattendue est survenue.",
    },
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`🚀 Serveur Bko_backend démarré sur http://localhost:${PORT}`);
  });
}

export default app;
