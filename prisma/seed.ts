import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  const seedMode = process.env.SEED_MODE || (isProduction ? "reference" : "all");

  console.log(`🌱 Ingestion du Seed Bko Podcast 55 Catalogue [Mode: ${seedMode}]...`);

  // ======================================================
  // 1. DONNÉES DE RÉFÉRENCE (REFERENCE DATA)
  // ======================================================

  // 1.1 PAYS (Country)
  const countriesData = [
    { id: "ML", name: "Mali", code: "ML", flagEmoji: "🇲🇱" },
    { id: "SN", name: "Sénégal", code: "SN", flagEmoji: "🇸🇳" },
    { id: "CI", name: "Côte d'Ivoire", code: "CI", flagEmoji: "🇨🇮" },
    { id: "BF", name: "Burkina Faso", code: "BF", flagEmoji: "🇧🇫" },
    { id: "GN", name: "Guinée", code: "GN", flagEmoji: "🇬🇳" },
    { id: "GH", name: "Ghana", code: "GH", flagEmoji: "🇬🇭" },
    { id: "NG", name: "Nigeria", code: "NG", flagEmoji: "🇳🇬" },
    { id: "FR", name: "France", code: "FR", flagEmoji: "🇫🇷" },
    { id: "US", name: "États-Unis", code: "US", flagEmoji: "🇺🇸" },
    { id: "CA", name: "Canada", code: "CA", flagEmoji: "🇨🇦" },
    { id: "UK", name: "Royaume-Uni", code: "UK", flagEmoji: "🇬🇧" },
  ];

  for (const c of countriesData) {
    await prisma.country.upsert({
      where: { id: c.id },
      update: c,
      create: c,
    });
  }

  // 1.2 MARCHÉS ET CAPACITÉS (Market)
  const marketsData = [
    { countryId: "ML", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "SN", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "CI", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "NG", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "GH", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "FR", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
    { countryId: "US", status: "ACTIVE" as const, discoveryEnabled: true, creatorSignupEnabled: true, podcastCreationEnabled: true, publishingEnabled: true, uploadEnabled: true, rssImportEnabled: true, monetizationEnabled: true, isFeatured: true },
  ];

  for (const m of marketsData) {
    await prisma.market.upsert({
      where: { countryId: m.countryId },
      update: m,
      create: m,
    });
  }

  // 1.3 LANGUES (Language)
  const languages = [
    { code: "fr", name: "Français", nativeName: "Français" },
    { code: "bm", name: "Bambara", nativeName: "Bamanankan" },
    { code: "en", name: "Anglais", nativeName: "English" },
  ];

  for (const l of languages) {
    await prisma.language.upsert({
      where: { code: l.code },
      update: l,
      create: l,
    });
  }

  // 1.4 CATÉGORIES (Category)
  const categories = [
    { slug: "business", name: "Business & Entrepreneuriat", description: "Économie, PME, startups et investissement", icon: "Briefcase" },
    { slug: "culture", name: "Culture & Société", description: "Arts, traditions, récits de vie et débats", icon: "Users" },
    { slug: "tech", name: "Innovation & Technologie", description: "Digital, IA, fintech et agrotech", icon: "Cpu" },
    { slug: "sport", name: "Sport & Jeunesse", description: "Football, basketball et culture sportive", icon: "Trophy" },
    { slug: "musique", name: "Musique & Création", description: "Interviews d'artistes et production sonore", icon: "Music" },
    { slug: "actualite", name: "Actualité & Médias", description: "Analyses géopolitiques et presse", icon: "Newspaper" },
    { slug: "diaspora", name: "Diaspora & Immersion", description: "Expériences, culture et récits de la diaspora", icon: "Globe" },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
  }

  // 1.5 RÔLES DE BASE
  const roles = ["USER", "CREATOR", "EDITOR", "ADMIN", "SUPER_ADMIN"];
  const createdRoles: Record<string, any> = {};
  for (const roleName of roles) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `Rôle système ${roleName}` },
    });
    createdRoles[roleName] = role;
  }

  // ======================================================
  // 2. COMPTE SUPER ADMIN (SALIKA FAMANTA)
  // ======================================================
  console.log("👤 Validation du compte Super Admin : Salika Famanta...");
  const adminPasswordHash = await bcrypt.hash("00alpha0010", 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: "salika.famanta@gmail.com" },
    update: {
      username: "salika",
      phoneNumber: "+22370009007",
      passwordHash: adminPasswordHash,
      fullName: "Salika Famanta",
      isVerified: true,
    },
    create: {
      email: "salika.famanta@gmail.com",
      username: "salika",
      phoneNumber: "+22370009007",
      fullName: "Salika Famanta",
      passwordHash: adminPasswordHash,
      isVerified: true,
      userRoles: {
        create: [
          { roleId: createdRoles["SUPER_ADMIN"].id },
          { roleId: createdRoles["ADMIN"].id },
          { roleId: createdRoles["CREATOR"].id },
        ],
      },
    },
  });

  // ======================================================
  // 3. INGESTION DU CATALOGUE DE 55 PODCASTS & CRÉATEURS
  // ======================================================
  console.log("📚 Ingestion du catalogue officiel des 55 podcasts Afrique & Diaspora...");

  const podcastsCatalogue = [
  {
    "slug": "nkunsigui",
    "name": "N'kunsigui",
    "creatorName": "N'kunsigui",
    "description": "N'kunsigui est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Culture & Beauté.",
    "cover": "https://img.youtube.com/vi/KWhVBP8YQaM/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "YouTube | Instagram",
    "episodes": [
      {
        "title": "N'kunsigui - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de N'kunsigui. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2100,
        "videoId": "KWhVBP8YQaM"
      },
      {
        "title": "N'kunsigui - Discussion & Perspectives #2",
        "description": "Deuxième session de N'kunsigui. Un échange riche et captivant avec des invités de marque.",
        "duration": 2400,
        "videoId": "4r7oPnCQa2w"
      }
    ]
  },
  {
    "slug": "tchete-podcast-kouma-bi-bolo",
    "name": "Tchete Podcast (Kouma Bi Bolo)",
    "creatorName": "Tchete",
    "description": "Tchete Podcast (Kouma Bi Bolo) est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Entrepreneuriat.",
    "cover": "https://img.youtube.com/vi/Rr6vUM3pKqc/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "business",
    "languageCode": "fr",
    "links": "YouTube | TikTok",
    "episodes": [
      {
        "title": "Tchete Podcast (Kouma Bi Bolo) - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Tchete Podcast (Kouma Bi Bolo). Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2220,
        "videoId": "Rr6vUM3pKqc"
      },
      {
        "title": "Tchete Podcast (Kouma Bi Bolo) - Discussion & Perspectives #2",
        "description": "Deuxième session de Tchete Podcast (Kouma Bi Bolo). Un échange riche et captivant avec des invités de marque.",
        "duration": 2490,
        "videoId": "wfJf9Dwpii8"
      }
    ]
  },
  {
    "slug": "voix-dimpact-impact-hub",
    "name": "Voix d'Impact (Impact Hub)",
    "creatorName": "Voix d'Impact",
    "description": "Voix d'Impact (Impact Hub) est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Impact Social.",
    "cover": "https://img.youtube.com/vi/xS_Z1P6pUwo/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify | YouTube",
    "episodes": [
      {
        "title": "Voix d'Impact (Impact Hub) - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Voix d'Impact (Impact Hub). Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2340,
        "videoId": "xS_Z1P6pUwo"
      },
      {
        "title": "Voix d'Impact (Impact Hub) - Discussion & Perspectives #2",
        "description": "Deuxième session de Voix d'Impact (Impact Hub). Un échange riche et captivant avec des invités de marque.",
        "duration": 2580,
        "videoId": "hN6BW1hHtvE"
      }
    ]
  },
  {
    "slug": "bamako-business-podcast",
    "name": "Bamako Business Podcast",
    "creatorName": "Bamako Business",
    "description": "Bamako Business Podcast est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Business.",
    "cover": "https://img.youtube.com/vi/4r7oPnCQa2w/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "business",
    "languageCode": "fr",
    "links": "Apple | Spotify",
    "episodes": [
      {
        "title": "Bamako Business Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Bamako Business Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2460,
        "videoId": "4r7oPnCQa2w"
      },
      {
        "title": "Bamako Business Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de Bamako Business Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 2670,
        "videoId": "ENheJuldFRA"
      }
    ]
  },
  {
    "slug": "dizuiti-kono",
    "name": "Dizuiti Kono",
    "creatorName": "Dizuiti Kono",
    "description": "Dizuiti Kono est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Société & Sport.",
    "cover": "https://img.youtube.com/vi/wfJf9Dwpii8/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "sport",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Dizuiti Kono - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Dizuiti Kono. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2580,
        "videoId": "wfJf9Dwpii8"
      },
      {
        "title": "Dizuiti Kono - Discussion & Perspectives #2",
        "description": "Deuxième session de Dizuiti Kono. Un échange riche et captivant avec des invités de marque.",
        "duration": 2760,
        "videoId": "dNr-ffzV3C0"
      }
    ]
  },
  {
    "slug": "hebdo-digital",
    "name": "HEBDO DIGITAL",
    "creatorName": "HEBDO DIGITAL",
    "description": "HEBDO DIGITAL est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Tech & Digital.",
    "cover": "https://img.youtube.com/vi/hN6BW1hHtvE/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "tech",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "HEBDO DIGITAL - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de HEBDO DIGITAL. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2700,
        "videoId": "hN6BW1hHtvE"
      },
      {
        "title": "HEBDO DIGITAL - Discussion & Perspectives #2",
        "description": "Deuxième session de HEBDO DIGITAL. Un échange riche et captivant avec des invités de marque.",
        "duration": 2850,
        "videoId": "V-i9FJBQKsc"
      }
    ]
  },
  {
    "slug": "djandjo-podcast",
    "name": "Djandjo Podcast",
    "creatorName": "Djandjo",
    "description": "Djandjo Podcast est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Citoyenneté.",
    "cover": "https://img.youtube.com/vi/ENheJuldFRA/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "actualite",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Djandjo Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Djandjo Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2820,
        "videoId": "ENheJuldFRA"
      },
      {
        "title": "Djandjo Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de Djandjo Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 2940,
        "videoId": "xwU5bHHe-O8"
      }
    ]
  },
  {
    "slug": "lescapade-du-captain",
    "name": "L'Escapade du Captain",
    "creatorName": "L'Escapade du Captain",
    "description": "L'Escapade du Captain est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Art & Culture.",
    "cover": "https://img.youtube.com/vi/dNr-ffzV3C0/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "L'Escapade du Captain - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de L'Escapade du Captain. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2940,
        "videoId": "dNr-ffzV3C0"
      },
      {
        "title": "L'Escapade du Captain - Discussion & Perspectives #2",
        "description": "Deuxième session de L'Escapade du Captain. Un échange riche et captivant avec des invités de marque.",
        "duration": 3030,
        "videoId": "XoHauAeOc-k"
      }
    ]
  },
  {
    "slug": "dakan-mali",
    "name": "Dakan Mali",
    "creatorName": "Dakan Mali",
    "description": "Dakan Mali est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Actualité AES.",
    "cover": "https://img.youtube.com/vi/V-i9FJBQKsc/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "actualite",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Dakan Mali - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Dakan Mali. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3060,
        "videoId": "V-i9FJBQKsc"
      },
      {
        "title": "Dakan Mali - Discussion & Perspectives #2",
        "description": "Deuxième session de Dakan Mali. Un échange riche et captivant avec des invités de marque.",
        "duration": 3120,
        "videoId": "cSkipHwUD-g"
      }
    ]
  },
  {
    "slug": "la-dg-du-quartier",
    "name": "La DG du Quartier",
    "creatorName": "La DG du Quartier",
    "description": "La DG du Quartier est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Parcours de vie.",
    "cover": "https://img.youtube.com/vi/xwU5bHHe-O8/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "TikTok",
    "episodes": [
      {
        "title": "La DG du Quartier - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de La DG du Quartier. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3180,
        "videoId": "xwU5bHHe-O8"
      },
      {
        "title": "La DG du Quartier - Discussion & Perspectives #2",
        "description": "Deuxième session de La DG du Quartier. Un échange riche et captivant avec des invités de marque.",
        "duration": 3210,
        "videoId": "hhBC6vfByt4"
      }
    ]
  },
  {
    "slug": "melting-pot",
    "name": "Melting Pot",
    "creatorName": "Melting Pot",
    "description": "Melting Pot est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Récits de vie.",
    "cover": "https://img.youtube.com/vi/XoHauAeOc-k/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "TikTok",
    "episodes": [
      {
        "title": "Melting Pot - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Melting Pot. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3300,
        "videoId": "XoHauAeOc-k"
      },
      {
        "title": "Melting Pot - Discussion & Perspectives #2",
        "description": "Deuxième session de Melting Pot. Un échange riche et captivant avec des invités de marque.",
        "duration": 3300,
        "videoId": "2_oOUSnibfo"
      }
    ]
  },
  {
    "slug": "tandem-aes",
    "name": "Tandem (AES)",
    "creatorName": "Tandem",
    "description": "Tandem (AES) est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Social & Syndical.",
    "cover": "https://img.youtube.com/vi/cSkipHwUD-g/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "actualite",
    "languageCode": "fr",
    "links": "Deezer",
    "episodes": [
      {
        "title": "Tandem (AES) - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Tandem (AES). Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3420,
        "videoId": "cSkipHwUD-g"
      },
      {
        "title": "Tandem (AES) - Discussion & Perspectives #2",
        "description": "Deuxième session de Tandem (AES). Un échange riche et captivant avec des invités de marque.",
        "duration": 3390,
        "videoId": "8vMvgWEqRKo"
      }
    ]
  },
  {
    "slug": "doctoforall",
    "name": "DoctoForAll",
    "creatorName": "DoctoForAll",
    "description": "DoctoForAll est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Santé & Digital.",
    "cover": "https://img.youtube.com/vi/hhBC6vfByt4/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "tech",
    "languageCode": "fr",
    "links": "Instagram",
    "episodes": [
      {
        "title": "DoctoForAll - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de DoctoForAll. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3540,
        "videoId": "hhBC6vfByt4"
      },
      {
        "title": "DoctoForAll - Discussion & Perspectives #2",
        "description": "Deuxième session de DoctoForAll. Un échange riche et captivant avec des invités de marque.",
        "duration": 3480,
        "videoId": "Dr9queg0kao"
      }
    ]
  },
  {
    "slug": "domo-actualités-sportive",
    "name": "Domo Actualités Sportive",
    "creatorName": "Domo Actualités Sportive",
    "description": "Domo Actualités Sportive est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Sport.",
    "cover": "https://img.youtube.com/vi/2_oOUSnibfo/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "sport",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Domo Actualités Sportive - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Domo Actualités Sportive. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3660,
        "videoId": "2_oOUSnibfo"
      },
      {
        "title": "Domo Actualités Sportive - Discussion & Perspectives #2",
        "description": "Deuxième session de Domo Actualités Sportive. Un échange riche et captivant avec des invités de marque.",
        "duration": 3570,
        "videoId": "KWhVBP8YQaM"
      }
    ]
  },
  {
    "slug": "sécurité-développement",
    "name": "Sécurité & Développement",
    "creatorName": "Sécurité & Développement",
    "description": "Sécurité & Développement est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Géopolitique.",
    "cover": "https://img.youtube.com/vi/8vMvgWEqRKo/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "actualite",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Sécurité & Développement - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Sécurité & Développement. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3780,
        "videoId": "8vMvgWEqRKo"
      },
      {
        "title": "Sécurité & Développement - Discussion & Perspectives #2",
        "description": "Deuxième session de Sécurité & Développement. Un échange riche et captivant avec des invités de marque.",
        "duration": 3660,
        "videoId": "Rr6vUM3pKqc"
      }
    ]
  },
  {
    "slug": "mali-mali",
    "name": "Mali Mali",
    "creatorName": "Mali Mali",
    "description": "Mali Mali est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Musique & Art.",
    "cover": "https://img.youtube.com/vi/Dr9queg0kao/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "musique",
    "languageCode": "fr",
    "links": "Apple",
    "episodes": [
      {
        "title": "Mali Mali - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Mali Mali. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2100,
        "videoId": "Dr9queg0kao"
      },
      {
        "title": "Mali Mali - Discussion & Perspectives #2",
        "description": "Deuxième session de Mali Mali. Un échange riche et captivant avec des invités de marque.",
        "duration": 3750,
        "videoId": "xS_Z1P6pUwo"
      }
    ]
  },
  {
    "slug": "doing-jazz-podcast",
    "name": "Doing Jazz Podcast",
    "creatorName": "Doing Jazz",
    "description": "Doing Jazz Podcast est un podcast d'exception (Mali 🇲🇱) abordant les thématiques : Musique.",
    "cover": "https://img.youtube.com/vi/KWhVBP8YQaM/maxresdefault.jpg",
    "countryId": "ML",
    "categorySlug": "musique",
    "languageCode": "fr",
    "links": "Instagram",
    "episodes": [
      {
        "title": "Doing Jazz Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Doing Jazz Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2220,
        "videoId": "KWhVBP8YQaM"
      },
      {
        "title": "Doing Jazz Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de Doing Jazz Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 3840,
        "videoId": "4r7oPnCQa2w"
      }
    ]
  },
  {
    "slug": "i-said-what-i-said-iswis",
    "name": "I Said What I Said (ISWIS)",
    "creatorName": "I Said What I Said",
    "description": "I Said What I Said (ISWIS) est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/Rr6vUM3pKqc/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "YouTube | Spotify",
    "episodes": [
      {
        "title": "I Said What I Said (ISWIS) - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de I Said What I Said (ISWIS). Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2340,
        "videoId": "Rr6vUM3pKqc"
      },
      {
        "title": "I Said What I Said (ISWIS) - Discussion & Perspectives #2",
        "description": "Deuxième session de I Said What I Said (ISWIS). Un échange riche et captivant avec des invités de marque.",
        "duration": 2430,
        "videoId": "wfJf9Dwpii8"
      }
    ]
  },
  {
    "slug": "sincerely-accra",
    "name": "Sincerely Accra",
    "creatorName": "Sincerely Accra",
    "description": "Sincerely Accra est un podcast d'exception (Ghana) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/xS_Z1P6pUwo/maxresdefault.jpg",
    "countryId": "GH",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify | YouTube",
    "episodes": [
      {
        "title": "Sincerely Accra - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Sincerely Accra. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2460,
        "videoId": "xS_Z1P6pUwo"
      },
      {
        "title": "Sincerely Accra - Discussion & Perspectives #2",
        "description": "Deuxième session de Sincerely Accra. Un échange riche et captivant avec des invités de marque.",
        "duration": 2520,
        "videoId": "hN6BW1hHtvE"
      }
    ]
  },
  {
    "slug": "abidjan-talk-live",
    "name": "Abidjan Talk Live",
    "creatorName": "Abidjan Talk Live",
    "description": "Abidjan Talk Live est un podcast d'exception (Côte d'Ivoire) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/4r7oPnCQa2w/maxresdefault.jpg",
    "countryId": "CI",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Apple | Facebook",
    "episodes": [
      {
        "title": "Abidjan Talk Live - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Abidjan Talk Live. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2580,
        "videoId": "4r7oPnCQa2w"
      },
      {
        "title": "Abidjan Talk Live - Discussion & Perspectives #2",
        "description": "Deuxième session de Abidjan Talk Live. Un échange riche et captivant avec des invités de marque.",
        "duration": 2610,
        "videoId": "ENheJuldFRA"
      }
    ]
  },
  {
    "slug": "wolof-tech",
    "name": "Wolof Tech",
    "creatorName": "Wolof Tech",
    "description": "Wolof Tech est un podcast d'exception (Sénégal) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/wfJf9Dwpii8/maxresdefault.jpg",
    "countryId": "SN",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify | YouTube",
    "episodes": [
      {
        "title": "Wolof Tech - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Wolof Tech. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2700,
        "videoId": "wfJf9Dwpii8"
      },
      {
        "title": "Wolof Tech - Discussion & Perspectives #2",
        "description": "Deuxième session de Wolof Tech. Un échange riche et captivant avec des invités de marque.",
        "duration": 2700,
        "videoId": "dNr-ffzV3C0"
      }
    ]
  },
  {
    "slug": "entrepreneur-state-of-africa",
    "name": "Entrepreneur State of Africa",
    "creatorName": "Entrepreneur State of Africa",
    "description": "Entrepreneur State of Africa est un podcast d'exception (Côte d'Ivoire) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/hN6BW1hHtvE/maxresdefault.jpg",
    "countryId": "CI",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "YouTube | Apple",
    "episodes": [
      {
        "title": "Entrepreneur State of Africa - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Entrepreneur State of Africa. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2820,
        "videoId": "hN6BW1hHtvE"
      },
      {
        "title": "Entrepreneur State of Africa - Discussion & Perspectives #2",
        "description": "Deuxième session de Entrepreneur State of Africa. Un échange riche et captivant avec des invités de marque.",
        "duration": 2790,
        "videoId": "V-i9FJBQKsc"
      }
    ]
  },
  {
    "slug": "stay-by-plan",
    "name": "Stay By Plan",
    "creatorName": "Stay By Plan",
    "description": "Stay By Plan est un podcast d'exception (Ghana) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/ENheJuldFRA/maxresdefault.jpg",
    "countryId": "GH",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify | YouTube",
    "episodes": [
      {
        "title": "Stay By Plan - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Stay By Plan. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2940,
        "videoId": "ENheJuldFRA"
      },
      {
        "title": "Stay By Plan - Discussion & Perspectives #2",
        "description": "Deuxième session de Stay By Plan. Un échange riche et captivant avec des invités de marque.",
        "duration": 2880,
        "videoId": "xwU5bHHe-O8"
      }
    ]
  },
  {
    "slug": "nigeria-daily",
    "name": "Nigeria Daily",
    "creatorName": "Nigeria Daily",
    "description": "Nigeria Daily est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/dNr-ffzV3C0/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "Nigeria Daily - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Nigeria Daily. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3060,
        "videoId": "dNr-ffzV3C0"
      },
      {
        "title": "Nigeria Daily - Discussion & Perspectives #2",
        "description": "Deuxième session de Nigeria Daily. Un échange riche et captivant avec des invités de marque.",
        "duration": 2970,
        "videoId": "XoHauAeOc-k"
      }
    ]
  },
  {
    "slug": "the-open-africa-podcast",
    "name": "The Open Africa Podcast",
    "creatorName": "The Open Africa",
    "description": "The Open Africa Podcast est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/V-i9FJBQKsc/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "The Open Africa Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Open Africa Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3180,
        "videoId": "V-i9FJBQKsc"
      },
      {
        "title": "The Open Africa Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de The Open Africa Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 3060,
        "videoId": "cSkipHwUD-g"
      }
    ]
  },
  {
    "slug": "loose-talk",
    "name": "Loose Talk",
    "creatorName": "Loose Talk",
    "description": "Loose Talk est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/xwU5bHHe-O8/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Loose Talk - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Loose Talk. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3300,
        "videoId": "xwU5bHHe-O8"
      },
      {
        "title": "Loose Talk - Discussion & Perspectives #2",
        "description": "Deuxième session de Loose Talk. Un échange riche et captivant avec des invités de marque.",
        "duration": 3150,
        "videoId": "hhBC6vfByt4"
      }
    ]
  },
  {
    "slug": "so-nigerian",
    "name": "So Nigerian",
    "creatorName": "So Nigerian",
    "description": "So Nigerian est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/XoHauAeOc-k/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "So Nigerian - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de So Nigerian. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3420,
        "videoId": "XoHauAeOc-k"
      },
      {
        "title": "So Nigerian - Discussion & Perspectives #2",
        "description": "Deuxième session de So Nigerian. Un échange riche et captivant avec des invités de marque.",
        "duration": 3240,
        "videoId": "2_oOUSnibfo"
      }
    ]
  },
  {
    "slug": "the-sex-sex-sex-show",
    "name": "The Sex Sex Sex Show",
    "creatorName": "The Sex Sex Sex Show",
    "description": "The Sex Sex Sex Show est un podcast d'exception (Ghana) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/cSkipHwUD-g/maxresdefault.jpg",
    "countryId": "GH",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "The Sex Sex Sex Show - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Sex Sex Sex Show. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3540,
        "videoId": "cSkipHwUD-g"
      },
      {
        "title": "The Sex Sex Sex Show - Discussion & Perspectives #2",
        "description": "Deuxième session de The Sex Sex Sex Show. Un échange riche et captivant avec des invités de marque.",
        "duration": 3330,
        "videoId": "8vMvgWEqRKo"
      }
    ]
  },
  {
    "slug": "winnie-akoury-podcast",
    "name": "Winnie Akoury Podcast",
    "creatorName": "Winnie Akoury",
    "description": "Winnie Akoury Podcast est un podcast d'exception (Côte d'Ivoire) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/hhBC6vfByt4/maxresdefault.jpg",
    "countryId": "CI",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Winnie Akoury Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Winnie Akoury Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3660,
        "videoId": "hhBC6vfByt4"
      },
      {
        "title": "Winnie Akoury Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de Winnie Akoury Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 3420,
        "videoId": "Dr9queg0kao"
      }
    ]
  },
  {
    "slug": "avantage-client",
    "name": "Avantage Client",
    "creatorName": "Avantage Client",
    "description": "Avantage Client est un podcast d'exception (Sénégal) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/2_oOUSnibfo/maxresdefault.jpg",
    "countryId": "SN",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Apple",
    "episodes": [
      {
        "title": "Avantage Client - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Avantage Client. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3780,
        "videoId": "2_oOUSnibfo"
      },
      {
        "title": "Avantage Client - Discussion & Perspectives #2",
        "description": "Deuxième session de Avantage Client. Un échange riche et captivant avec des invités de marque.",
        "duration": 3510,
        "videoId": "KWhVBP8YQaM"
      }
    ]
  },
  {
    "slug": "afropod",
    "name": "Afropod",
    "creatorName": "Afropod",
    "description": "Afropod est un podcast d'exception (Sénégal) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/8vMvgWEqRKo/maxresdefault.jpg",
    "countryId": "SN",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Apple",
    "episodes": [
      {
        "title": "Afropod - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Afropod. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2100,
        "videoId": "8vMvgWEqRKo"
      },
      {
        "title": "Afropod - Discussion & Perspectives #2",
        "description": "Deuxième session de Afropod. Un échange riche et captivant avec des invités de marque.",
        "duration": 3600,
        "videoId": "Rr6vUM3pKqc"
      }
    ]
  },
  {
    "slug": "menisms",
    "name": "Menisms",
    "creatorName": "Menisms",
    "description": "Menisms est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/Dr9queg0kao/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Menisms - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Menisms. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2220,
        "videoId": "Dr9queg0kao"
      },
      {
        "title": "Menisms - Discussion & Perspectives #2",
        "description": "Deuxième session de Menisms. Un échange riche et captivant avec des invités de marque.",
        "duration": 3690,
        "videoId": "xS_Z1P6pUwo"
      }
    ]
  },
  {
    "slug": "tea-with-tay",
    "name": "Tea with Tay",
    "creatorName": "Tea with Tay",
    "description": "Tea with Tay est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/KWhVBP8YQaM/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "YouTube",
    "episodes": [
      {
        "title": "Tea with Tay - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Tea with Tay. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2340,
        "videoId": "KWhVBP8YQaM"
      },
      {
        "title": "Tea with Tay - Discussion & Perspectives #2",
        "description": "Deuxième session de Tea with Tay. Un échange riche et captivant avec des invités de marque.",
        "duration": 3780,
        "videoId": "4r7oPnCQa2w"
      }
    ]
  },
  {
    "slug": "off-air-with-jane-and-jj",
    "name": "Off Air with Jane and JJ",
    "creatorName": "Off Air with Jane and JJ",
    "description": "Off Air with Jane and JJ est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/Rr6vUM3pKqc/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "Off Air with Jane and JJ - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Off Air with Jane and JJ. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2460,
        "videoId": "Rr6vUM3pKqc"
      },
      {
        "title": "Off Air with Jane and JJ - Discussion & Perspectives #2",
        "description": "Deuxième session de Off Air with Jane and JJ. Un échange riche et captivant avec des invités de marque.",
        "duration": 3870,
        "videoId": "wfJf9Dwpii8"
      }
    ]
  },
  {
    "slug": "african-tech-roundup",
    "name": "African Tech Roundup",
    "creatorName": "African Tech Roundup",
    "description": "African Tech Roundup est un podcast d'exception (Régional) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/xS_Z1P6pUwo/maxresdefault.jpg",
    "countryId": "SN",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify",
    "episodes": [
      {
        "title": "African Tech Roundup - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de African Tech Roundup. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2580,
        "videoId": "xS_Z1P6pUwo"
      },
      {
        "title": "African Tech Roundup - Discussion & Perspectives #2",
        "description": "Deuxième session de African Tech Roundup. Un échange riche et captivant avec des invités de marque.",
        "duration": 2460,
        "videoId": "hN6BW1hHtvE"
      }
    ]
  },
  {
    "slug": "the-comb",
    "name": "The Comb",
    "creatorName": "The Comb",
    "description": "The Comb est un podcast d'exception (BBC Africa) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/4r7oPnCQa2w/maxresdefault.jpg",
    "countryId": "UK",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "BBC",
    "episodes": [
      {
        "title": "The Comb - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Comb. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2700,
        "videoId": "4r7oPnCQa2w"
      },
      {
        "title": "The Comb - Discussion & Perspectives #2",
        "description": "Deuxième session de The Comb. Un échange riche et captivant avec des invités de marque.",
        "duration": 2550,
        "videoId": "ENheJuldFRA"
      }
    ]
  },
  {
    "slug": "africa-rights-talk",
    "name": "Africa Rights Talk",
    "creatorName": "Africa Rights Talk",
    "description": "Africa Rights Talk est un podcast d'exception (Régional) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/wfJf9Dwpii8/maxresdefault.jpg",
    "countryId": "SN",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Africa Rights Talk - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Africa Rights Talk. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2820,
        "videoId": "wfJf9Dwpii8"
      },
      {
        "title": "Africa Rights Talk - Discussion & Perspectives #2",
        "description": "Deuxième session de Africa Rights Talk. Un échange riche et captivant avec des invités de marque.",
        "duration": 2640,
        "videoId": "dNr-ffzV3C0"
      }
    ]
  },
  {
    "slug": "submarine-and-a-roach",
    "name": "Submarine and a Roach",
    "creatorName": "Submarine and a Roach",
    "description": "Submarine and a Roach est un podcast d'exception (Nigeria) abordant les thématiques : Culture & Société.",
    "cover": "https://img.youtube.com/vi/hN6BW1hHtvE/maxresdefault.jpg",
    "countryId": "NG",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Submarine and a Roach - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Submarine and a Roach. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2940,
        "videoId": "hN6BW1hHtvE"
      },
      {
        "title": "Submarine and a Roach - Discussion & Perspectives #2",
        "description": "Deuxième session de Submarine and a Roach. Un échange riche et captivant avec des invités de marque.",
        "duration": 2730,
        "videoId": "V-i9FJBQKsc"
      }
    ]
  },
  {
    "slug": "le-tchip",
    "name": "Le Tchip",
    "creatorName": "Le Tchip",
    "description": "Le Tchip est un podcast d'exception (Diaspora (France)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/ENheJuldFRA/maxresdefault.jpg",
    "countryId": "FR",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Le Tchip - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Le Tchip. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3060,
        "videoId": "ENheJuldFRA"
      },
      {
        "title": "Le Tchip - Discussion & Perspectives #2",
        "description": "Deuxième session de Le Tchip. Un échange riche et captivant avec des invités de marque.",
        "duration": 2820,
        "videoId": "xwU5bHHe-O8"
      }
    ]
  },
  {
    "slug": "kiffe-ta-race",
    "name": "Kiffe ta race",
    "creatorName": "Kiffe ta race",
    "description": "Kiffe ta race est un podcast d'exception (Diaspora (France)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/dNr-ffzV3C0/maxresdefault.jpg",
    "countryId": "FR",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify | Binge Audio",
    "episodes": [
      {
        "title": "Kiffe ta race - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Kiffe ta race. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3180,
        "videoId": "dNr-ffzV3C0"
      },
      {
        "title": "Kiffe ta race - Discussion & Perspectives #2",
        "description": "Deuxième session de Kiffe ta race. Un échange riche et captivant avec des invités de marque.",
        "duration": 2910,
        "videoId": "XoHauAeOc-k"
      }
    ]
  },
  {
    "slug": "miroir-miroir",
    "name": "Miroir Miroir",
    "creatorName": "Miroir Miroir",
    "description": "Miroir Miroir est un podcast d'exception (Diaspora (France)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/V-i9FJBQKsc/maxresdefault.jpg",
    "countryId": "FR",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Miroir Miroir - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Miroir Miroir. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3300,
        "videoId": "V-i9FJBQKsc"
      },
      {
        "title": "Miroir Miroir - Discussion & Perspectives #2",
        "description": "Deuxième session de Miroir Miroir. Un échange riche et captivant avec des invités de marque.",
        "duration": 3000,
        "videoId": "cSkipHwUD-g"
      }
    ]
  },
  {
    "slug": "the-read",
    "name": "The Read",
    "creatorName": "The Read",
    "description": "The Read est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/xwU5bHHe-O8/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Website | Apple",
    "episodes": [
      {
        "title": "The Read - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Read. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3420,
        "videoId": "xwU5bHHe-O8"
      },
      {
        "title": "The Read - Discussion & Perspectives #2",
        "description": "Deuxième session de The Read. Un échange riche et captivant avec des invités de marque.",
        "duration": 3090,
        "videoId": "hhBC6vfByt4"
      }
    ]
  },
  {
    "slug": "jesus-and-jollof",
    "name": "Jesus and Jollof",
    "creatorName": "Jesus and Jollof",
    "description": "Jesus and Jollof est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/XoHauAeOc-k/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "Jesus and Jollof - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Jesus and Jollof. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3540,
        "videoId": "XoHauAeOc-k"
      },
      {
        "title": "Jesus and Jollof - Discussion & Perspectives #2",
        "description": "Deuxième session de Jesus and Jollof. Un échange riche et captivant avec des invités de marque.",
        "duration": 3180,
        "videoId": "2_oOUSnibfo"
      }
    ]
  },
  {
    "slug": "side-hustle-pro",
    "name": "Side Hustle Pro",
    "creatorName": "Side Hustle Pro",
    "description": "Side Hustle Pro est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/cSkipHwUD-g/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify | Website",
    "episodes": [
      {
        "title": "Side Hustle Pro - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Side Hustle Pro. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3660,
        "videoId": "cSkipHwUD-g"
      },
      {
        "title": "Side Hustle Pro - Discussion & Perspectives #2",
        "description": "Deuxième session de Side Hustle Pro. Un échange riche et captivant avec des invités de marque.",
        "duration": 3270,
        "videoId": "8vMvgWEqRKo"
      }
    ]
  },
  {
    "slug": "therapy-for-black-girls",
    "name": "Therapy for Black Girls",
    "creatorName": "Therapy for Black Girls",
    "description": "Therapy for Black Girls est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/hhBC6vfByt4/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Website",
    "episodes": [
      {
        "title": "Therapy for Black Girls - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Therapy for Black Girls. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3780,
        "videoId": "hhBC6vfByt4"
      },
      {
        "title": "Therapy for Black Girls - Discussion & Perspectives #2",
        "description": "Deuxième session de Therapy for Black Girls. Un échange riche et captivant avec des invités de marque.",
        "duration": 3360,
        "videoId": "Dr9queg0kao"
      }
    ]
  },
  {
    "slug": "small-doses",
    "name": "Small Doses",
    "creatorName": "Small Doses",
    "description": "Small Doses est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/2_oOUSnibfo/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "Small Doses - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Small Doses. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2100,
        "videoId": "2_oOUSnibfo"
      },
      {
        "title": "Small Doses - Discussion & Perspectives #2",
        "description": "Deuxième session de Small Doses. Un échange riche et captivant avec des invités de marque.",
        "duration": 3450,
        "videoId": "KWhVBP8YQaM"
      }
    ]
  },
  {
    "slug": "the-bakari-sellers-podcast",
    "name": "The Bakari Sellers Podcast",
    "creatorName": "The Bakari Sellers",
    "description": "The Bakari Sellers Podcast est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/8vMvgWEqRKo/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "The Bakari Sellers Podcast - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Bakari Sellers Podcast. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2220,
        "videoId": "8vMvgWEqRKo"
      },
      {
        "title": "The Bakari Sellers Podcast - Discussion & Perspectives #2",
        "description": "Deuxième session de The Bakari Sellers Podcast. Un échange riche et captivant avec des invités de marque.",
        "duration": 3540,
        "videoId": "Rr6vUM3pKqc"
      }
    ]
  },
  {
    "slug": "black-girl-songbook",
    "name": "Black Girl Songbook",
    "creatorName": "Black Girl Songbook",
    "description": "Black Girl Songbook est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/Dr9queg0kao/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Black Girl Songbook - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Black Girl Songbook. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2340,
        "videoId": "Dr9queg0kao"
      },
      {
        "title": "Black Girl Songbook - Discussion & Perspectives #2",
        "description": "Deuxième session de Black Girl Songbook. Un échange riche et captivant avec des invités de marque.",
        "duration": 3630,
        "videoId": "xS_Z1P6pUwo"
      }
    ]
  },
  {
    "slug": "balanced-black-girl",
    "name": "Balanced Black Girl",
    "creatorName": "Balanced Black Girl",
    "description": "Balanced Black Girl est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/KWhVBP8YQaM/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Website",
    "episodes": [
      {
        "title": "Balanced Black Girl - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Balanced Black Girl. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2460,
        "videoId": "KWhVBP8YQaM"
      },
      {
        "title": "Balanced Black Girl - Discussion & Perspectives #2",
        "description": "Deuxième session de Balanced Black Girl. Un échange riche et captivant avec des invités de marque.",
        "duration": 3720,
        "videoId": "4r7oPnCQa2w"
      }
    ]
  },
  {
    "slug": "code-switch",
    "name": "Code Switch",
    "creatorName": "Code Switch",
    "description": "Code Switch est un podcast d'exception (Diaspora (USA (NPR))) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/Rr6vUM3pKqc/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Website",
    "episodes": [
      {
        "title": "Code Switch - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Code Switch. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2580,
        "videoId": "Rr6vUM3pKqc"
      },
      {
        "title": "Code Switch - Discussion & Perspectives #2",
        "description": "Deuxième session de Code Switch. Un échange riche et captivant avec des invités de marque.",
        "duration": 3810,
        "videoId": "wfJf9Dwpii8"
      }
    ]
  },
  {
    "slug": "higher-learning",
    "name": "Higher Learning",
    "creatorName": "Higher Learning",
    "description": "Higher Learning est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/xS_Z1P6pUwo/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Spotify",
    "episodes": [
      {
        "title": "Higher Learning - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Higher Learning. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2700,
        "videoId": "xS_Z1P6pUwo"
      },
      {
        "title": "Higher Learning - Discussion & Perspectives #2",
        "description": "Deuxième session de Higher Learning. Un échange riche et captivant avec des invités de marque.",
        "duration": 2400,
        "videoId": "hN6BW1hHtvE"
      }
    ]
  },
  {
    "slug": "ratchet-respectable",
    "name": "Ratchet & Respectable",
    "creatorName": "Ratchet & Respectable",
    "description": "Ratchet & Respectable est un podcast d'exception (Diaspora (USA)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/4r7oPnCQa2w/maxresdefault.jpg",
    "countryId": "US",
    "categorySlug": "culture",
    "languageCode": "en",
    "links": "Apple",
    "episodes": [
      {
        "title": "Ratchet & Respectable - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Ratchet & Respectable. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2820,
        "videoId": "4r7oPnCQa2w"
      },
      {
        "title": "Ratchet & Respectable - Discussion & Perspectives #2",
        "description": "Deuxième session de Ratchet & Respectable. Un échange riche et captivant avec des invités de marque.",
        "duration": 2490,
        "videoId": "ENheJuldFRA"
      }
    ]
  },
  {
    "slug": "diaspora-story",
    "name": "Diaspora Story",
    "creatorName": "Diaspora Story",
    "description": "Diaspora Story est un podcast d'exception (Diaspora (USA/Canada)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/wfJf9Dwpii8/maxresdefault.jpg",
    "countryId": "CA",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Apple",
    "episodes": [
      {
        "title": "Diaspora Story - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de Diaspora Story. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 2940,
        "videoId": "wfJf9Dwpii8"
      },
      {
        "title": "Diaspora Story - Discussion & Perspectives #2",
        "description": "Deuxième session de Diaspora Story. Un échange riche et captivant avec des invités de marque.",
        "duration": 2580,
        "videoId": "dNr-ffzV3C0"
      }
    ]
  },
  {
    "slug": "the-migration-diaspora",
    "name": "The Migration & Diaspora",
    "creatorName": "The Migration & Diaspora",
    "description": "The Migration & Diaspora est un podcast d'exception (Diaspora (Europe)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/hN6BW1hHtvE/maxresdefault.jpg",
    "countryId": "FR",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Apple",
    "episodes": [
      {
        "title": "The Migration & Diaspora - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de The Migration & Diaspora. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3060,
        "videoId": "hN6BW1hHtvE"
      },
      {
        "title": "The Migration & Diaspora - Discussion & Perspectives #2",
        "description": "Deuxième session de The Migration & Diaspora. Un échange riche et captivant avec des invités de marque.",
        "duration": 2670,
        "videoId": "V-i9FJBQKsc"
      }
    ]
  },
  {
    "slug": "lafro-apéro",
    "name": "L'Afro Apéro",
    "creatorName": "L'Afro Apéro",
    "description": "L'Afro Apéro est un podcast d'exception (Diaspora (France)) abordant les thématiques : Diaspora & Culture.",
    "cover": "https://img.youtube.com/vi/ENheJuldFRA/maxresdefault.jpg",
    "countryId": "FR",
    "categorySlug": "culture",
    "languageCode": "fr",
    "links": "Spotify",
    "episodes": [
      {
        "title": "L'Afro Apéro - Épisode Inaugural #1",
        "description": "Écoutez le premier épisode exclusif de L'Afro Apéro. Débat approfondi et réflexions inspirantes sur la culture, la société et le développement.",
        "duration": 3180,
        "videoId": "ENheJuldFRA"
      },
      {
        "title": "L'Afro Apéro - Discussion & Perspectives #2",
        "description": "Deuxième session de L'Afro Apéro. Un échange riche et captivant avec des invités de marque.",
        "duration": 2760,
        "videoId": "xwU5bHHe-O8"
      }
    ]
  }
];

  for (const item of podcastsCatalogue) {
    // 1. Upsert Creator / Person
    const personSlug = `person-${item.slug}`;
    const person = await prisma.person.upsert({
      where: { slug: personSlug },
      update: {
        name: item.creatorName,
        bio: `Créateur & Hôte officiel de l'émission ${item.name}.`,
        countryId: item.countryId,
      },
      create: {
        slug: personSlug,
        name: item.creatorName,
        bio: `Créateur & Hôte officiel de l'émission ${item.name}.`,
        countryId: item.countryId,
      },
    });

    // 2. Upsert Podcast
    const podcast = await prisma.podcast.upsert({
      where: { slug: item.slug },
      update: {
        name: item.name,
        description: item.description,
        cover: item.cover,
        primaryLanguageCode: item.languageCode,
        countryId: item.countryId,
      },
      create: {
        slug: item.slug,
        name: item.name,
        description: item.description,
        cover: item.cover,
        primaryLanguageCode: item.languageCode,
        countryId: item.countryId,
        status: "PUBLISHED",
        isOfficial: true,
      },
    });

    // 3. Link Person as HOST of Podcast
    await prisma.podcastPerson.upsert({
      where: {
        podcastId_personId: {
          podcastId: podcast.id,
          personId: person.id,
        },
      },
      update: { role: "HOST" },
      create: {
        podcastId: podcast.id,
        personId: person.id,
        role: "HOST",
      },
    });

    // 4. Ingest Episodes & MediaSources
    for (let i = 0; i < item.episodes.length; i++) {
      const ep = item.episodes[i];
      const epSlug = `${item.slug}-ep-${i + 1}`;

      const episode = await prisma.episode.upsert({
        where: {
          podcastId_slug: {
            podcastId: podcast.id,
            slug: epSlug,
          },
        },
        update: {
          title: ep.title,
          description: ep.description,
          cover: item.cover,
          durationSeconds: ep.duration,
          languageCode: item.languageCode,
        },
        create: {
          podcastId: podcast.id,
          slug: epSlug,
          title: ep.title,
          description: ep.description,
          cover: item.cover,
          durationSeconds: ep.duration,
          languageCode: item.languageCode,
          publishedAt: new Date(Date.now() - (i + 1) * 86400000),
          status: "PUBLISHED",
        },
      });

      // MediaSource YouTube
      await prisma.mediaSource.deleteMany({
        where: { episodeId: episode.id },
      });

      await prisma.mediaSource.create({
        data: {
          episodeId: episode.id,
          type: "VIDEO",
          sourceType: "EXTERNAL",
          provider: "YOUTUBE",
          playbackMode: "EMBED",
          isPrimaryVideo: true,
          externalId: ep.videoId,
          externalUrl: `https://www.youtube.com/watch?v=${ep.videoId}`,
          embedUrl: `https://www.youtube.com/embed/${ep.videoId}`,
          durationSeconds: ep.duration,
        },
      });
    }
  }

  console.log("🎉 Ingestion terminée avec succès ! 55 Podcasts & Créateurs ingérés.");
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
