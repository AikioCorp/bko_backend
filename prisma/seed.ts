import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  const seedMode = process.env.SEED_MODE || (isProduction ? "reference" : "all");

  console.log(`🌱 Ingestion du Seed [Mode: ${seedMode}]...`);

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
    {
      countryId: "ML",
      status: "ACTIVE" as const,
      discoveryEnabled: true,
      creatorSignupEnabled: true,
      podcastCreationEnabled: true,
      publishingEnabled: true,
      uploadEnabled: true,
      rssImportEnabled: true,
      monetizationEnabled: true,
      isFeatured: true,
      launchDate: new Date("2026-01-01"),
    },
    {
      countryId: "SN",
      status: "CATALOG_ONLY" as const,
      discoveryEnabled: true,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
    {
      countryId: "CI",
      status: "CATALOG_ONLY" as const,
      discoveryEnabled: true,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
    {
      countryId: "BF",
      status: "CATALOG_ONLY" as const,
      discoveryEnabled: true,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
    {
      countryId: "GN",
      status: "DISABLED" as const,
      discoveryEnabled: false,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
    {
      countryId: "GH",
      status: "DISABLED" as const,
      discoveryEnabled: false,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
    {
      countryId: "NG",
      status: "DISABLED" as const,
      discoveryEnabled: false,
      creatorSignupEnabled: false,
      podcastCreationEnabled: false,
      publishingEnabled: false,
      uploadEnabled: false,
      rssImportEnabled: false,
      monetizationEnabled: false,
      isFeatured: false,
    },
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
    { slug: "business", name: "Business & Entrepreneuriat", description: "Économie, PME, startups et investissement au Mali et en Afrique", icon: "Briefcase" },
    { slug: "culture", name: "Culture & Société", description: "Arts, traditions, histoire mandingue et dynamique sociale", icon: "Users" },
    { slug: "tech", name: "Innovation & Technologie", description: "Digital, intelligence artificielle, fintech et agrotech", icon: "Cpu" },
    { slug: "sport", name: "Sport & Jeunesse", description: "Football africain, basketball et culture sportive", icon: "Trophy" },
    { slug: "musique", name: "Musique & Création", description: "Interviews d'artistes, univers kora, afrobeats et production", icon: "Music" },
    { slug: "actualite", name: "Actualité & Médias", description: "Analyses géopolitiques, presse et débats contemporains", icon: "Newspaper" },
    { slug: "agriculture", name: "Agriculture & Agrobusiness", description: "Souveraineté alimentaire, coton, maraîchage et élevage", icon: "Sprout" },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
  }

  // 1.5 SUJETS DE RÉFÉRENCE & ALIAS (Topic)
  const topicsData = [
    {
      slug: "entrepreneuriat-mali",
      name: "Entrepreneuriat au Mali",
      description: "Opportunités d'affaires à Bamako, Ségou, Sikasso et Mopti",
      aliases: ["Bamako Business", "Maliden Kounnafoni", "Entreprendre Bamako"],
    },
    {
      slug: "financement-pme",
      name: "Financement PME & Capital Risque",
      description: "Accès au crédit bancaire, microfinance et levée de fonds",
      aliases: ["Wari KO", "Fonds d'investissement Mali", "Investir au Mali"],
    },
    {
      slug: "culture-mandingue",
      name: "Culture & Histoire Mandingue",
      description: "Épopée de Soundiata Keïta, charte de Kouroukan Fouga et traditions",
      aliases: ["Mali Foyi", "Mali Kono", "Kouroukan Fouga", "Soundiata Keita"],
    },
    {
      slug: "agrobusiness-sahel",
      name: "Agrobusiness & Transformation",
      description: "Valorisation de la mangue, de l'anacarde, du sésame et du coton",
      aliases: ["Sénéko", "Agri-Mali", "Office du Niger"],
    },
    {
      slug: "fintech-afrique",
      name: "Fintech & Mobile Money",
      description: "Paiement mobile, Orange Money, Wave et inclusion financière",
      aliases: ["Wari Digital", "Mobile Banking Sahel"],
    },
  ];

  for (const t of topicsData) {
    const topic = await prisma.topic.upsert({
      where: { slug: t.slug },
      update: { name: t.name, description: t.description },
      create: { slug: t.slug, name: t.name, description: t.description },
    });

    for (const alias of t.aliases) {
      await prisma.topicAlias.deleteMany({ where: { topicId: topic.id, alias } });
      await prisma.topicAlias.create({
        data: {
          topicId: topic.id,
          alias: alias,
        },
      });
    }
  }

  // 1.6 RÔLES DE BASE (Roles)
  const roles = ["USER", "CREATOR", "EDITOR", "ADMIN", "SUPER_ADMIN"];
  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `Rôle système ${roleName}` },
    });
  }

  console.log("✅ Seed des données de RÉFÉRENCE terminé avec succès !");

  if (seedMode === "reference" || isProduction) {
    console.log("🔒 Mode Production / Reference détecté : Les données de DEMO ne seront PAS créées.");
    return;
  }

  // ======================================================
  // 2. DONNÉES DE DÉMONSTRATION (DEMO DATA ONLY - DEV/STAGING)
  // ======================================================
  console.log("🛠️ Ingestion des données de DEMO (Développement / Staging)...");

  const passwordHash = await bcrypt.hash("Bamako2026!", 10);
  const roleCreator = await prisma.role.findUnique({ where: { name: "CREATOR" } });

  const personsData = [
    {
      slug: "mohamed-traore",
      name: "Mohamed Traoré",
      bio: "Fondateur du Studio Bamako Podcast, journaliste et producteur audiovisuel à Bamako.",
      countryId: "ML",
      city: "Bamako",
    },
    {
      slug: "fatoumata-coulibaly",
      name: "Fatoumata Coulibaly",
      bio: "Experte en agrobusiness, entrepreneure sociale et fondatrice de Sahel Innovation.",
      countryId: "ML",
      city: "Sikasso",
    },
  ];

  const createdPersons: Record<string, any> = {};

  for (const p of personsData) {
    const person = await prisma.person.upsert({
      where: { slug: p.slug },
      update: p,
      create: p,
    });
    createdPersons[p.slug] = person;
  }

  const userMohamed = await prisma.user.upsert({
    where: { email: "mohamed.traore@bamakopodcast.studio" },
    update: {},
    create: {
      email: "mohamed.traore@bamakopodcast.studio",
      fullName: "Mohamed Traoré",
      passwordHash: passwordHash,
      isVerified: true,
      userRoles: roleCreator ? { create: { roleId: roleCreator.id } } : undefined,
    },
  });

  await prisma.creatorProfile.upsert({
    where: { userId: userMohamed.id },
    update: {},
    create: {
      userId: userMohamed.id,
      personId: createdPersons["mohamed-traore"]?.id,
      displayName: "Mohamed Traoré",
      slug: "mohamed-traore",
      bio: "Fondateur et animateur au Studio Bamako Podcast",
      countryId: "ML",
      isVerified: true,
    },
  });

  console.log("✅ Ingestion des données de DEMO terminée !");
}

main()
  .catch((e) => {
    console.error("❌ Erreur lors de l'exécution du seed :", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
