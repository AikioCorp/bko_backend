import { prisma } from "../../config/prisma.js";
import { slugify } from "../creator/creator-profile.service.js";
import { AuditService } from "../../services/audit.service.js";

export class AdminPersonService {
  static async listPeople(search?: string) {
    return prisma.person.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { aliases: { some: { alias: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : undefined,
      include: {
        country: true,
        aliases: true,
        _count: { select: { episodeAppearances: true, podcastAppearances: true } },
      },
      orderBy: { name: "asc" },
      take: 50,
    });
  }

  static async createPerson(adminUserId: string, data: { name: string; bio?: string; photo?: string; countryId?: string; city?: string; website?: string; aliases?: string[] }) {
    let slugBase = slugify(data.name);
    let slug = slugBase;
    let count = 1;
    while (await prisma.person.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    const person = await prisma.person.create({
      data: {
        name: data.name,
        slug,
        bio: data.bio,
        photo: data.photo,
        countryId: data.countryId,
        city: data.city,
        website: data.website,
        ...(data.aliases
          ? { aliases: { create: data.aliases.map((alias) => ({ alias })) } }
          : {}),
      },
      include: { aliases: true, country: true },
    });

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PERSON_CREATED",
      entityType: "PERSON",
      entityId: person.id,
      newState: person,
    });

    return person;
  }

  static async mergePeople(adminUserId: string, primaryId: string, duplicateId: string) {
    if (primaryId === duplicateId) throw new Error("MERGE_SAME_PERSON");

    const [primary, duplicate] = await Promise.all([
      prisma.person.findUnique({ where: { id: primaryId } }),
      prisma.person.findUnique({ where: { id: duplicateId } }),
    ]);

    if (!primary || !duplicate) throw new Error("PERSON_NOT_FOUND");

    await prisma.$transaction(async (tx) => {
      // Transfert des apparitions d'épisodes
      const dupEpisodes = await tx.episodePerson.findMany({ where: { personId: duplicateId } });
      for (const ep of dupEpisodes) {
        await tx.episodePerson.upsert({
          where: { episodeId_personId: { episodeId: ep.episodeId, personId: primaryId } },
          update: {},
          create: { episodeId: ep.episodeId, personId: primaryId, role: ep.role },
        });
      }
      await tx.episodePerson.deleteMany({ where: { personId: duplicateId } });

      // Transfert des apparitions de podcasts
      const dupPodcasts = await tx.podcastPerson.findMany({ where: { personId: duplicateId } });
      for (const pod of dupPodcasts) {
        await tx.podcastPerson.upsert({
          where: { podcastId_personId: { podcastId: pod.podcastId, personId: primaryId } },
          update: {},
          create: { podcastId: pod.podcastId, personId: primaryId, role: pod.role },
        });
      }
      await tx.podcastPerson.deleteMany({ where: { personId: duplicateId } });

      // Ajouter le nom de la personne doublon comme alias
      await tx.personAlias.create({
        data: {
          personId: primaryId,
          alias: duplicate.name,
        },
      });

      // Transfert des aliases existants
      await tx.personAlias.updateMany({
        where: { personId: duplicateId },
        data: { personId: primaryId },
      });

      // Redirection slug
      await tx.slugRedirect.create({
        data: {
          entityType: "PERSON",
          oldSlug: duplicate.slug,
          newSlug: primary.slug,
          targetId: primaryId,
        },
      });

      await tx.person.delete({ where: { id: duplicateId } });
    });

    await AuditService.logAction({
      actorId: adminUserId,
      action: "PERSON_MERGED",
      entityType: "PERSON",
      entityId: primaryId,
      previousState: { duplicateId },
      newState: { primaryId },
    });

    return { success: true, message: `Personne ${duplicate.name} fusionnée avec succès.` };
  }
}
