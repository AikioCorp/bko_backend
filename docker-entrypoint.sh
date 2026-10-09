#!/bin/sh
set -e

# Effectuer les migrations Prisma au démarrage si RUN_MIGRATIONS != false
if [ "$RUN_MIGRATIONS" != "false" ]; then
  echo "🚀 [Migration] Application des migrations Prisma sur la base VPS..."
  node scripts/verify-migrations.cjs
  
  # Nettoyer la base des potentiels caractères invisibles Windows (\r) qui causent P3015
  node scripts/fix-prisma-migrations.cjs || true
  
  npx prisma migrate deploy

  # Exécuter le seed initial si activé
  if [ "$AUTO_SEED" = "true" ] || [ "$RUN_SEED" = "true" ]; then
    echo "🌱 [Seed] Initialisation du catalogue et données de référence (mode: ${SEED_MODE:-reference})..."
    npm run prisma:seed || echo "⚠️ Seed terminé (ou données déjà présentes)."
  fi
fi

echo "🚀 [Application] Démarrage du processus : $@"
exec "$@"
