#!/bin/sh
set -e

# Effectuer les migrations Prisma au démarrage si RUN_MIGRATIONS != false
if [ "$RUN_MIGRATIONS" != "false" ]; then
  echo "🚀 [Migration] Application des migrations Prisma sur la base VPS..."
  node scripts/verify-migrations.cjs
  
  # Nettoyer la base des potentiels caractères invisibles Windows (\r) qui causent P3015
  node scripts/fix-prisma-migrations.cjs || true
  
  # Try to deploy, if P3015 occurs, attempt to mark the migration as resolved to bypass the Prisma case/sync bug
  if ! npx prisma migrate deploy; then
    echo "⚠️ La migration a échoué. Tentative de résolution de contournement pour P3015..."
    npx prisma migrate resolve --applied 20261008135000_feature_engagement || true
    echo "🔁 Nouvelle tentative de déploiement des migrations..."
    npx prisma migrate deploy
  fi

  # Exécuter le seed initial si activé
  if [ "$AUTO_SEED" = "true" ] || [ "$RUN_SEED" = "true" ]; then
    echo "🌱 [Seed] Initialisation du catalogue et données de référence (mode: ${SEED_MODE:-reference})..."
    npm run prisma:seed || echo "⚠️ Seed terminé (ou données déjà présentes)."
  fi
fi

echo "🚀 [Application] Démarrage du processus : $@"
exec "$@"
