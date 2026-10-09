const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log("🛠️ Nettoyage de la table _prisma_migrations...");
    // Nettoyer les caractères de fin invisibles
    await prisma.$executeRawUnsafe(`
      UPDATE _prisma_migrations 
      SET migration_name = TRIM(BOTH E'\\r' FROM TRIM(BOTH E'\\n' FROM TRIM(migration_name)));
    `);

    // Supprimer les migrations enregistrées comme échouées (rolled_back_at IS NOT NULL ou finished_at IS NULL)
    // pour permettre à Prisma de réappliquer le script idempotent proprement
    const deleted = await prisma.$executeRawUnsafe(`
      DELETE FROM _prisma_migrations 
      WHERE rolled_back_at IS NOT NULL OR finished_at IS NULL;
    `);
    if (deleted > 0) {
      console.log(`🧹 ${deleted} enregistrement(s) de migration échouée nettoyé(s).`);
    }
    console.log("✅ Table _prisma_migrations prête.");
  } catch (error) {
    console.error("Erreur lors du nettoyage :", error.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
