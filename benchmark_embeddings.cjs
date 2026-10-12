const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

async function run() {
  try {
    const epCount = await prisma.episodeEmbedding.count();
    const podCount = await prisma.podcastEmbedding.count();
    console.log('EPISODE_EMBEDDINGS_COUNT:', epCount);
    console.log('PODCAST_EMBEDDINGS_COUNT:', podCount);

    const groups = await prisma.episodeEmbedding.groupBy({
      by: ['provider', 'model'],
      _count: { id: true }
    });
    console.log('GROUPS:', JSON.stringify(groups));

    // Mesurer la vitesse du calcul cosinus in-process sur un ensemble de 500 vecteurs de 1024 dimensions
    const v1 = new Float64Array(1024);
    for (let i = 0; i < 1024; i++) v1[i] = Math.random();
    
    const candidates = [];
    for (let j = 0; j < 500; j++) {
      const vec = new Float64Array(1024);
      for (let i = 0; i < 1024; i++) vec[i] = Math.random();
      candidates.push(vec);
    }

    const t0 = performance.now();
    let topScore = -1;
    for (const c of candidates) {
      let dot = 0;
      let nA = 0;
      let nB = 0;
      for (let i = 0; i < 1024; i++) {
        dot += v1[i] * c[i];
        nA += v1[i] * v1[i];
        nB += c[i] * c[i];
      }
      const score = dot / (Math.sqrt(nA) * Math.sqrt(nB));
      if (score > topScore) topScore = score;
    }
    const t1 = performance.now();
    console.log('BENCHMARK_500_VECTORS_1024D_MS:', (t1 - t0).toFixed(2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
