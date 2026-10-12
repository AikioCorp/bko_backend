import { prisma } from "./src/config/prisma.js";

async function main() {
  const ext = await prisma.$queryRawUnsafe<any[]>("SELECT * FROM pg_available_extensions WHERE name = 'vector'");
  console.log("pgvector in pg_available_extensions:", ext);
  const installed = await prisma.$queryRawUnsafe<any[]>("SELECT * FROM pg_extension WHERE extname = 'vector'");
  console.log("pgvector installed:", installed);
}

main().catch(console.error).finally(() => prisma.$disconnect());
