const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const youtubeVideos = [
    // Top Episodes
    {
      title: "N'kunsigui - Podcast Interview",
      channel: "N'kunsigui",
      videoId: "KWhVBP8YQaM",
      thumbnailUrl: "https://img.youtube.com/vi/KWhVBP8YQaM/maxresdefault.jpg",
      category: "Culture & Lifestyle",
    },
    {
      title: "Baba Cmn - Interview Exclusive",
      channel: "Baba Cmn",
      videoId: "Rr6vUM3pKqc",
      thumbnailUrl: "https://img.youtube.com/vi/Rr6vUM3pKqc/maxresdefault.jpg",
      category: "Entrepreneuriat",
    },
    {
      title: "Impact Hub Bamako - Innovation au Mali",
      channel: "Impact Hub Bamako",
      videoId: "xS_Z1P6pUwo",
      thumbnailUrl: "https://img.youtube.com/vi/xS_Z1P6pUwo/maxresdefault.jpg",
      category: "Business & Économie",
    },
    {
      title: "Dizuiti Kono - Épisode #1",
      channel: "Dizuiti Kono",
      videoId: "4r7oPnCQa2w",
      thumbnailUrl: "https://img.youtube.com/vi/4r7oPnCQa2w/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "HEBDO DIGITAL EPISODE 1 - Femmes et Digital",
      channel: "Aikio Corp",
      videoId: "wfJf9Dwpii8",
      thumbnailUrl: "https://img.youtube.com/vi/wfJf9Dwpii8/maxresdefault.jpg",
      category: "Business & Économie",
    },
    {
      title: "N'kunsigui - Session Spéciale #2",
      channel: "N'kunsigui",
      videoId: "ENheJuldFRA",
      thumbnailUrl: "https://img.youtube.com/vi/ENheJuldFRA/maxresdefault.jpg",
      category: "Culture & Lifestyle",
    },
    {
      title: "Djandjo Podcast - Première Émission",
      channel: "RPMEDIASTV",
      videoId: "hN6BW1hHtvE",
      thumbnailUrl: "https://img.youtube.com/vi/hN6BW1hHtvE/maxresdefault.jpg",
      category: "Entrepreneuriat",
    },
    {
      title: "Impact Hub Bamako - Startup Week",
      channel: "Impact Hub Bamako",
      videoId: "hhBC6vfByt4",
      thumbnailUrl: "https://img.youtube.com/vi/hhBC6vfByt4/maxresdefault.jpg",
      category: "Business & Économie",
    },
    {
      title: "Dizuiti Kono - Débats de Société",
      channel: "Dizuiti Kono",
      videoId: "2_oOUSnibfo",
      thumbnailUrl: "https://img.youtube.com/vi/2_oOUSnibfo/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "Sécurité et Développement du Sahel: Enjeux et Perspectives",
      channel: "Aikio Corp",
      videoId: "7Rxz0A2Ul8k",
      thumbnailUrl: "https://img.youtube.com/vi/7Rxz0A2Ul8k/maxresdefault.jpg",
      category: "Productions Spéciales",
    },
    {
      title: "N'kunsigui - Culture et Tradition",
      channel: "N'kunsigui",
      videoId: "dNr-ffzV3C0",
      thumbnailUrl: "https://img.youtube.com/vi/dNr-ffzV3C0/maxresdefault.jpg",
      category: "Culture & Lifestyle",
    },
    {
      title: "HEBDO DIGITAL Ep 2 - Les métiers du Numérique",
      channel: "Aikio Corp",
      videoId: "XoHauAeOc-k",
      thumbnailUrl: "https://img.youtube.com/vi/XoHauAeOc-k/maxresdefault.jpg",
      category: "Business & Économie",
    },
    {
      title: "Dizuiti Kono - Politique et Gouvernance",
      channel: "Dizuiti Kono",
      videoId: "8vMvgWEqRKo",
      thumbnailUrl: "https://img.youtube.com/vi/8vMvgWEqRKo/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "Djandjo Podcast - Débat Citoyen",
      channel: "RPMEDIASTV",
      videoId: "cSkipHwUD-g",
      thumbnailUrl: "https://img.youtube.com/vi/cSkipHwUD-g/maxresdefault.jpg",
      category: "Entrepreneuriat",
    },
    {
      title: "N'kunsigui - Musique et Société",
      channel: "N'kunsigui",
      videoId: "V-i9FJBQKsc",
      thumbnailUrl: "https://img.youtube.com/vi/V-i9FJBQKsc/maxresdefault.jpg",
      category: "Culture & Lifestyle",
    },
    {
      title: "Domo Actualités Sportive",
      channel: "Aikio Corp",
      videoId: "hxIWlOPiYoE",
      thumbnailUrl: "https://img.youtube.com/vi/hxIWlOPiYoE/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "Dizuiti Kono - Économie Malienne",
      channel: "Dizuiti Kono",
      videoId: "Dr9queg0kao",
      thumbnailUrl: "https://img.youtube.com/vi/Dr9queg0kao/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "N'kunsigui - Projets et Avenir",
      channel: "N'kunsigui",
      videoId: "xwU5bHHe-O8",
      thumbnailUrl: "https://img.youtube.com/vi/xwU5bHHe-O8/maxresdefault.jpg",
      category: "Culture & Lifestyle",
    },
    {
      title: "Dizuiti Kono - Jeunesse et Éducation",
      channel: "Dizuiti Kono",
      videoId: "4Z3_Ij7F9mw",
      thumbnailUrl: "https://img.youtube.com/vi/4Z3_Ij7F9mw/maxresdefault.jpg",
      category: "Émissions Sport",
    },
    {
      title: "Dizuiti Kono - Développement Local",
      channel: "Dizuiti Kono",
      videoId: "pNCOqBsF6Ho",
      thumbnailUrl: "https://img.youtube.com/vi/pNCOqBsF6Ho/maxresdefault.jpg",
      category: "Émissions Sport",
    },
];

const categoryNames = [
  "Émissions Sport",
  "Business & Économie",
  "Culture & Lifestyle",
  "Entrepreneuriat",
  "Productions Spéciales",
  "Podcast Interview",
];

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

async function run() {
  console.log('Cleaning up old seeded non-RSS podcasts and episodes...');
  
  const podsToDelete = await prisma.podcast.findMany({
    where: { rssFeed: null },
    select: { id: true }
  });

  const podIds = podsToDelete.map(p => p.id);

  if (podIds.length > 0) {
    console.log(`Deleting ${podIds.length} podcasts...`);
    await prisma.episode.deleteMany({ where: { podcastId: { in: podIds } } });
    await prisma.podcastCategory.deleteMany({ where: { podcastId: { in: podIds } } });
    await prisma.claim.deleteMany({ where: { podcastId: { in: podIds } } });
    await prisma.podcast.deleteMany({ where: { id: { in: podIds } } });
  }

  // Ensure categories exist
  console.log('Ensuring categories exist...');
  const categoryMap = {};
  for (const c of categoryNames) {
    const slug = slugify(c);
    let cat = await prisma.category.findUnique({ where: { slug } });
    if (!cat) {
      cat = await prisma.category.create({
        data: { name: c, slug }
      });
    }
    categoryMap[c] = cat.id;
  }

  // Get admin user (to own the newly seeded podcasts for now, or null)
  // const admin = await prisma.user.findFirst({ where: { roles: { has: "SUPER_ADMIN" } } });
  
  // Find "Mali" country
  let mali = await prisma.country.findFirst({ where: { code: 'ML' } });

  // Map videos by channel
  const byChannel = {};
  for (const v of youtubeVideos) {
    if (!byChannel[v.channel]) byChannel[v.channel] = [];
    byChannel[v.channel].push(v);
  }

  for (const channelName of Object.keys(byChannel)) {
    const slug = slugify(channelName);
    const videos = byChannel[channelName];
    // Use the most frequent category for the podcast
    const catFreq = {};
    for (const v of videos) catFreq[v.category] = (catFreq[v.category] || 0) + 1;
    const mainCat = Object.keys(catFreq).sort((a,b) => catFreq[b] - catFreq[a])[0];

    const podcast = await prisma.podcast.create({
      data: {
        name: channelName,
        slug: slug,
        description: `Podcast produit par ${channelName}`,
        status: "PUBLISHED", 
        
        cover: videos[0].thumbnailUrl,
        countryId: mali?.id, primaryLanguageCode: "fr",
        categories: {
          create: [{ categoryId: categoryMap[mainCat] }]
        }
      }
    });

    console.log(`Created podcast: ${podcast.name}`);

    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const epSlug = slugify(v.title);
      await prisma.episode.create({
        data: {
          podcastId: podcast.id,
          title: v.title,
          slug: `${epSlug}-${Math.random().toString(36).substring(2,6)}`,
          description: `Épisode de ${v.channel}. Regardez la vidéo : https://www.youtube.com/watch?v=${v.videoId}`,
          status: "PUBLISHED", 
           publishedAt: new Date(Date.now() - (i * 86400000)), // spaced by 1 day
          cover: v.thumbnailUrl,
          mediaSources: {
            create: [
              {
                type: "VIDEO", sourceType: "EXTERNAL",
                provider: "YOUTUBE",
                
                externalUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
                playbackMode: "EMBED"
              }
            ]
          }
        }
      });
      console.log(` - Created episode: ${v.title}`);
    }
  }

  console.log('Seeding complete!');
}

run().catch(console.error).finally(() => prisma.$disconnect());
