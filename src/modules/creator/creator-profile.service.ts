import { prisma } from "../../config/prisma.js";

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Enlever les accents
    .trim()
    .replace(/\s+/g, "-") // Espaces en tirets
    .replace(/[^\w\-]+/g, "") // Supprimer caractères non autorisés
    .replace(/\-\-+/g, "-");
}

export class CreatorProfileService {
  static async getProfile(userId: string) {
    const profile = await prisma.creatorProfile.findUnique({
      where: { userId },
      include: {
        person: true,
        country: true,
      },
    });
    return profile;
  }

  static async createProfile(
    userId: string,
    data: {
      displayName: string;
      bio?: string;
      avatar?: string;
      banner?: string;
      countryId?: string;
      website?: string;
      socialLinks?: any;
      personId?: string;
      createPerson?: boolean;
    }
  ) {
    const existing = await prisma.creatorProfile.findUnique({ where: { userId } });
    if (existing) throw new Error("CREATOR_PROFILE_EXISTS");

    let slugBase = slugify(data.displayName);
    let slug = slugBase;
    let count = 1;

    while (await prisma.creatorProfile.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    let linkedPersonId = data.personId;

    // Si demandé, créer automatiquement la fiche Person rattachée
    if (data.createPerson && !linkedPersonId) {
      let personSlugBase = slugify(data.displayName);
      let personSlug = personSlugBase;
      let pCount = 1;
      while (await prisma.person.findUnique({ where: { slug: personSlug } })) {
        pCount++;
        personSlug = `${personSlugBase}-${pCount}`;
      }

      const person = await prisma.person.create({
        data: {
          name: data.displayName,
          slug: personSlug,
          bio: data.bio,
          photo: data.avatar,
          countryId: data.countryId,
          website: data.website,
          socialLinks: data.socialLinks,
        },
      });
      linkedPersonId = person.id;
    }

    const creator = await prisma.creatorProfile.create({
      data: {
        userId,
        displayName: data.displayName,
        slug,
        bio: data.bio,
        avatar: data.avatar,
        banner: data.banner,
        countryId: data.countryId,
        website: data.website,
        socialLinks: data.socialLinks,
        personId: linkedPersonId,
      },
      include: {
        person: true,
        country: true,
      },
    });

    return creator;
  }

  static async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      bio?: string;
      avatar?: string;
      banner?: string;
      countryId?: string;
      website?: string;
      socialLinks?: any;
      personId?: string;
    }
  ) {
    const profile = await prisma.creatorProfile.findUnique({ where: { userId } });
    if (!profile) throw new Error("CREATOR_PROFILE_NOT_FOUND");

    return prisma.creatorProfile.update({
      where: { userId },
      data,
      include: {
        person: true,
        country: true,
      },
    });
  }

  static async getPublicProfileBySlug(slug: string) {
    const profile = await prisma.creatorProfile.findUnique({
      where: { slug },
      include: {
        person: {
          include: {
            podcastAppearances: {
              include: { podcast: true },
            },
          },
        },
        country: true,
        user: {
          include: {
            podcastMemberships: {
              include: { podcast: true },
            },
          },
        },
      },
    });
    if (!profile) throw new Error("CREATOR_NOT_FOUND");
    return profile;
  }
}
