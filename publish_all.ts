import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const res = await prisma.podcast.updateMany({
    where: { status: "DRAFT" },
    data: { status: "PUBLISHED" }
  });
  console.log(`Published ${res.count} podcasts!`);
  await prisma.$disconnect();
}
main().catch(console.error);
