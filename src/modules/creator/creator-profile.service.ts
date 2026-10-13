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
  static async getStudioAccess(userId: string) {
    const [profile, membership, roles] = await Promise.all([
      prisma.creatorProfile.findUnique({ where: { userId } }),
      prisma.podcastMember.findFirst({ where: { userId }, select: { id: true } }),
      prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
    ]);
    const staff = roles.some(({ role }) => ["ADMIN", "SUPER_ADMIN", "EDITOR"].includes(role.name));
    return { canAccess: Boolean(profile || membership || staff), canCreatePodcast: Boolean(profile),
      creatorProfile: profile, isCollaborator: Boolean(membership), isStaff: staff };
  }
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
    if (!data || typeof data.displayName !== "string" || !data.displayName.trim() || data.displayName.trim().length > 100) {
      throw new Error("INVALID_CREATOR_NAME");
    }
    data = { ...data, displayName: data.displayName.trim() };
    if (data.bio !== undefined && (typeof data.bio !== "string" || data.bio.length > 2000)) {
      throw new Error("INVALID_CREATOR_BIO");
    }
    if (data.website) {
      try {
        const url = new URL(data.website);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      } catch { throw new Error("INVALID_URL"); }
    }
    return prisma.$transaction(async (tx) => {
      // Serialize activation for this account (double tap or retry after network loss).
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.creatorProfile.findUnique({ where: { userId } });


      if (existing) {
        const role = await tx.role.findUnique({ where: { name: "CREATOR" } });
        if (!role) throw new Error("CREATOR_ROLE_UNAVAILABLE");
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: role.id } },
          create: { userId, roleId: role.id }, update: {},
        });
        return existing;
      }
      let slugBase = slugify(data.displayName) || "createur";
      let slug = slugBase;
      let count = 1;

      while (await tx.creatorProfile.findUnique({ where: { slug } })) {
        count++;
        slug = `${slugBase}-${count}`;
      }

      let linkedPersonId = data.personId;

      // Si demandé, créer automatiquement la fiche Person rattachée
      if (data.createPerson && !linkedPersonId) {
        let personSlugBase = slugify(data.displayName) || "createur";
        let personSlug = personSlugBase;
        let pCount = 1;
        while (await tx.person.findUnique({ where: { slug: personSlug } })) {
          pCount++;
          personSlug = `${personSlugBase}-${pCount}`;
        }

        const person = await tx.person.create({
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

      const creator = await tx.creatorProfile.create({
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

      const creatorRole = await tx.role.findUnique({ where: { name: "CREATOR" } });
      if (!creatorRole) throw new Error("CREATOR_ROLE_UNAVAILABLE");
      if (creatorRole) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId, roleId: creatorRole.id } },
          create: { userId, roleId: creatorRole.id },
          update: {},
        });
      }

      return creator;
      });
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
