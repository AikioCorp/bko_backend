import { PrismaClient, EditorialSectionType, EditorialSourceMode } from "@prisma/client";

const prisma = new PrismaClient();

export class AdminEditorialError extends Error {
  constructor(message: string, public code: string = "EDITORIAL_ERROR", public status: number = 400) {
    super(message);
  }
}

export class AdminEditorialService {
  // --- EDITORIAL SECTIONS ---
  static async listSections() {
    return prisma.editorialSection.findMany({
      orderBy: { position: "asc" },
      include: {
        _count: { select: { items: true } },
      }
    });
  }

  static async getSection(idOrSlug: string) {
    return prisma.editorialSection.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: { select: { id: true, name: true, cover: true, slug: true } },
            episode: { select: { id: true, title: true, cover: true, slug: true } },
            collection: { select: { id: true, title: true, cover: true, slug: true } },
          }
        }
      }
    });
  }

  static async createSection(data: any) {
    if (!data.title || !data.type) throw new AdminEditorialError("Le titre et le type sont requis.");
    
    // Auto-generate slug
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString().slice(-4);
    
    // Get max position
    const maxPos = await prisma.editorialSection.aggregate({ _max: { position: true } });
    const position = (maxPos._max.position || 0) + 1;

    return prisma.editorialSection.create({
      data: {
        title: data.title,
        slug,
        subtitle: data.subtitle || null,
        type: data.type as EditorialSectionType,
        sourceMode: (data.sourceMode || "MANUAL") as EditorialSourceMode,
        isActive: data.isActive ?? false,
        position,
        maxItems: data.maxItems ? Number(data.maxItems) : 12,
        isFixedPlacement: Boolean(data.isFixedPlacement),
        priority: data.priority ? Number(data.priority) : 0,
        selectionStrategy: data.selectionStrategy || "DEFAULT",
        strategyParams: data.strategyParams || null,
      }
    });
  }

  static async updateSection(id: string, data: any) {
    return prisma.editorialSection.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.subtitle !== undefined ? { subtitle: data.subtitle } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.sourceMode !== undefined ? { sourceMode: data.sourceMode } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.maxItems !== undefined ? { maxItems: Number(data.maxItems) } : {}),
        ...(data.isFixedPlacement !== undefined ? { isFixedPlacement: Boolean(data.isFixedPlacement) } : {}),
        ...(data.priority !== undefined ? { priority: Number(data.priority) } : {}),
        ...(data.selectionStrategy !== undefined ? { selectionStrategy: data.selectionStrategy } : {}),
        ...(data.strategyParams !== undefined ? { strategyParams: data.strategyParams } : {}),
      }
    });
  }
  
  static async updateSectionsOrder(ids: string[]) {
    // ids is an ordered array of section IDs
    const updates = ids.map((id, index) => 
      prisma.editorialSection.update({
        where: { id },
        data: { position: index }
      })
    );
    await prisma.$transaction(updates);
    return true;
  }

  static async addSectionItem(sectionId: string, itemData: any) {
    // Get max position for this section
    const maxPos = await prisma.editorialSectionItem.aggregate({
      where: { sectionId },
      _max: { position: true }
    });
    const position = (maxPos._max.position || 0) + 1;

    return prisma.editorialSectionItem.create({
      data: {
        sectionId,
        podcastId: itemData.podcastId || null,
        episodeId: itemData.episodeId || null,
        collectionId: itemData.collectionId || null,
        position,
      }
    });
  }

  static async removeSectionItem(itemId: string) {
    return prisma.editorialSectionItem.delete({
      where: { id: itemId }
    });
  }

  static async updateSectionItemsOrder(sectionId: string, itemIds: string[]) {
    const updates = itemIds.map((id, index) =>
      prisma.editorialSectionItem.update({
        where: { id, sectionId },
        data: { position: index }
      })
    );
    await prisma.$transaction(updates);
    return true;
  }
  
  // --- COLLECTIONS ---
  static async listCollections() {
    return prisma.collection.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { items: true } }
      }
    });
  }

  static async getCollection(idOrSlug: string) {
    return prisma.collection.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        items: {
          orderBy: { position: "asc" },
          include: {
            podcast: { select: { id: true, name: true, cover: true, slug: true } },
            episode: { select: { id: true, title: true, cover: true, slug: true } },
          }
        }
      }
    });
  }

  static async createCollection(data: any) {
    if (!data.title) throw new AdminEditorialError("Le titre est requis.");
    
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString().slice(-4);
    
    return prisma.collection.create({
      data: {
        title: data.title,
        slug,
        description: data.description || null,
        cover: data.cover || null,
        isFeatured: data.isFeatured ?? false,
      }
    });
  }

  static async updateCollection(id: string, data: any) {
    return prisma.collection.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        cover: data.cover,
        isFeatured: data.isFeatured,
      }
    });
  }

  static async addCollectionItem(collectionId: string, itemData: any) {
    const maxPos = await prisma.collectionItem.aggregate({
      where: { collectionId },
      _max: { position: true }
    });
    const position = (maxPos._max.position || 0) + 1;

    return prisma.collectionItem.create({
      data: {
        collectionId,
        podcastId: itemData.podcastId || null,
        episodeId: itemData.episodeId || null,
        position,
      }
    });
  }

  static async removeCollectionItem(itemId: string) {
    return prisma.collectionItem.delete({
      where: { id: itemId }
    });
  }

  static async updateCollectionItemsOrder(collectionId: string, itemIds: string[]) {
    const updates = itemIds.map((id, index) =>
      prisma.collectionItem.update({
        where: { id, collectionId },
        data: { position: index }
      })
    );
    await prisma.$transaction(updates);
    return true;
  }
}
