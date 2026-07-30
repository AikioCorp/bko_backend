import { prisma } from "../../config/prisma.js";
import { slugify } from "../creator/creator-profile.service.js";

export class CollectionService {
  static async listCollections() {
    return prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } },
      },
    });
  }

  static async getCollectionBySlug(slug: string) {
    return prisma.collection.findUnique({
      where: { slug },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: { include: { country: true, primaryLanguage: true } },
            episode: { include: { mediaSources: true } },
            person: true,
            topic: true,
          },
        },
      },
    });
  }

  static async createCollection(data: { title: string; description?: string; cover?: string; isFeatured?: boolean }) {
    let slugBase = slugify(data.title);
    let slug = slugBase;
    let count = 1;
    while (await prisma.collection.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    return prisma.collection.create({
      data: {
        title: data.title,
        slug,
        description: data.description,
        cover: data.cover,
        isFeatured: data.isFeatured ?? false,
      },
    });
  }

  static async updateCollectionItems(
    collectionId: string,
    items: Array<{ podcastId?: string; episodeId?: string; personId?: string; topicId?: string; position: number }>
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.collectionItem.deleteMany({ where: { collectionId } });

      return tx.collectionItem.createMany({
        data: items.map((item) => ({
          collectionId,
          podcastId: item.podcastId,
          episodeId: item.episodeId,
          personId: item.personId,
          topicId: item.topicId,
          position: item.position,
        })),
      });
    });
  }
}
