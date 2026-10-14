import { prisma } from "../src/config/prisma.js";

export async function seedStudioOffers() {
  console.log("🎙️ Initialisation des tarifs du Studio...");

  const defaultOffers = [
    {
      type: "PACKAGE" as const,
      name: "Enregistrement Brut",
      price: "20 000",
      unit: "FCFA / h",
      description: "Pour ceux qui souhaitent récupérer leurs fichiers audio et vidéo afin de réaliser leur propre montage.",
      features: [
        "Studio Principal / Annexe : 20 000 FCFA / h",
        "Salle de Conférence : 25 000 FCFA / h",
        "Salle VIP : 25 000 FCFA / h",
        "Extérieur : 60 000 FCFA / h",
        "Fichiers audio bruts WAV & vidéo MP4 (Full HD / 4K) remis immédiatement",
        "Micros Shure SM7B broadcast & cabine traitée acoustiquement",
        "Ingénieur du son dédié pour le monitoring et la prise de voix",
      ],
      isPopular: false,
      iconName: "raw",
      isActive: true,
      order: 1,
    },
    {
      type: "PACKAGE" as const,
      name: "Formule Express",
      price: "35 000",
      unit: "FCFA / h",
      description: "Une captation dynamique avec plusieurs angles de vue et une réalisation en direct. Repartez avec une vidéo prête à être diffusée dès la fin de votre session.",
      features: [
        "Studio Principal / Annexe : 35 000 FCFA / h",
        "Salle de Conférence : 40 000 FCFA / h",
        "Salle VIP : 50 000 FCFA / h",
        "Réalisation multi-caméras en direct (commutation live des plans)",
        "Vidéo finalisée et exportée prête à publier dès la fin de votre session",
        "Habillage visuel personnalisé (logos, synthés, titres des invités)",
        "Mastering et mixage son professionnel en temps réel",
      ],
      isPopular: true,
      iconName: "express",
      isActive: true,
      order: 2,
    },
    {
      type: "SERVICE" as const,
      name: "Montage & Post-production complète",
      price: "25 000",
      unit: "FCFA / épisode",
      description: "Dérushage, découpe des hésitations, synchronisation audio/vidéo et colorimétrie professionnelle.",
      features: [
        "Étalonnage vidéo & nettoyage des bruits parasites",
        "Ajout générique, virgules sonores et transitions",
        "2 allers-retours de retouches inclus",
      ],
      isPopular: false,
      iconName: "edit",
      isActive: true,
      order: 3,
    },
    {
      type: "SERVICE" as const,
      name: "Pack Shorts & Reels (3 extraits)",
      price: "15 000",
      unit: "FCFA / pack",
      description: "3 extraits percutants verticaux (format 9:16) avec sous-titres animés pour maximiser votre visibilité.",
      features: [
        "Format vertical 9:16 (TikTok, Reels, Shorts)",
        "Sous-titres mot-à-mot dynamiques",
        "Accroches et teasers viraux calibrés",
      ],
      isPopular: false,
      iconName: "video",
      isActive: true,
      order: 4,
    },
    {
      type: "SERVICE" as const,
      name: "Coaching & Direction Éditoriale",
      price: "30 000",
      unit: "FCFA / session",
      description: "Session de cadrage d'1h30 avec un producteur pour affûter votre concept et structurer vos interviews.",
      features: [
        "Positionnement et ligne éditoriale du podcast",
        "Grille de questions d'interview percutantes",
        "Conseils de prise de parole et présence au micro",
      ],
      isPopular: false,
      iconName: "coach",
      isActive: true,
      order: 5,
    },
  ];

  for (const offer of defaultOffers) {
    const existing = await prisma.studioOffer.findFirst({
      where: { name: offer.name },
    });

    if (existing) {
      await prisma.studioOffer.update({
        where: { id: existing.id },
        data: offer,
      });
      console.log(`  ✓ Offre mise à jour : ${offer.name}`);
    } else {
      await prisma.studioOffer.create({
        data: offer,
      });
      console.log(`  + Offre créée : ${offer.name}`);
    }
  }

  console.log("✅ Tarifs du studio initialisés avec succès !");
}

if (process.argv[1]?.includes("seed-studio-offers")) {
  seedStudioOffers()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
