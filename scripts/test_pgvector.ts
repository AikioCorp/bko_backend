import { prisma } from "../src/config/prisma.js";

async function main() {
  try {
    const sample = await prisma.episodeEmbedding.findFirst({
      where: { status: "COMPLETED" },
      select: { episodeId: true, vector: true }
    });
    if (!sample) return;

    console.log("Testing pgvector query on EpisodeEmbedding...");
    const formatted = `[${sample.vector.slice(0, 10).join(",")}]`;
    
    // Test 1: ee.vector::text::vector or (ee.vector::real[])::vector
    try {
      const q1 = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ee."episodeId", ((ee.vector::real[])::vector <=> (ARRAY[${sample.vector.slice(0, 10).join(",")}]::real[])::vector) as distance
         FROM "EpisodeEmbedding" ee
         LIMIT 3`
      );
      console.log("Q1 ((ee.vector::real[])::vector) worked! Samples:", q1.length);
    } catch (e: any) {
      console.log("Q1 failed:", e.message);
    }

    try {
      const q2 = await prisma.$queryRawUnsafe<any[]>(
        `SELECT ee."episodeId", (ee.vector::vector <=> $1::vector) as distance
         FROM "EpisodeEmbedding" ee
         LIMIT 3`,
        `[${sample.vector.join(",")}]`
      );
      console.log("Q2 (ee.vector::vector) worked! Samples:", q2.length);
    } catch (e: any) {
      console.log("Q2 failed:", e.message);
    }

  } catch (err: any) {
    console.error("Test error:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
