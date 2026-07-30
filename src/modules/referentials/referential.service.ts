import { prisma } from "../../config/prisma.js";

export class ReferentialService {
  static async getCategories() {
    return prisma.category.findMany({
      include: { _count: { select: { podcasts: true } } },
    });
  }

  static async getCategoryBySlug(slug: string) {
    return prisma.category.findUnique({
      where: { slug },
      include: {
        podcasts: {
          include: {
            podcast: {
              include: {
                country: true,
                primaryLanguage: true,
                _count: { select: { episodes: true, followers: true } },
              },
            },
          },
        },
      },
    });
  }

  static async getTopics() {
    return prisma.topic.findMany({
      include: {
        aliases: true,
        _count: { select: { podcasts: true, episodes: true } },
      },
    });
  }

  static async getTopicBySlug(slug: string) {
    return prisma.topic.findUnique({
      where: { slug },
      include: {
        aliases: true,
        podcasts: {
          include: {
            podcast: {
              include: {
                country: true,
                primaryLanguage: true,
              },
            },
          },
        },
        episodes: {
          include: {
            episode: {
              include: {
                podcast: { include: { country: true } },
                mediaSources: true,
              },
            },
          },
        },
      },
    });
  }

  static async getCountries() {
    return prisma.country.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { podcasts: true } } },
    });
  }

  static async getCountryByCode(code: string) {
    return prisma.country.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        podcasts: {
          where: { status: "PUBLISHED" },
          include: {
            primaryLanguage: true,
            categories: { include: { category: true } },
          },
        },
        persons: true,
      },
    });
  }

  static async getLanguages() {
    return prisma.language.findMany({
      include: { _count: { select: { primaryPodcasts: true } } },
    });
  }

  static async getLanguageByCode(code: string) {
    return prisma.language.findUnique({
      where: { code },
      include: {
        primaryPodcasts: {
          where: { status: "PUBLISHED" },
          include: {
            country: true,
            categories: { include: { category: true } },
          },
        },
      },
    });
  }
}
