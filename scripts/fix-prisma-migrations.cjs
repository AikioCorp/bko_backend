const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log("🛠️ Nettoyage de la table _prisma_migrations des caractères invisibles...");
    // Update all migration names to remove carriage returns, newlines, and trailing spaces
    await prisma.$executeRawUnsafe(`
      UPDATE _prisma_migrations 
      SET migration_name = TRIM(BOTH E'\\r' FROM TRIM(BOTH E'\\n' FROM TRIM(migration_name)));
    `);
    console.log("✅ Table _prisma_migrations nettoyée.");
  } catch (error) {
    console.error("Erreur lors du nettoyage :", error.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
