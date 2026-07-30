import { prisma } from "../../config/prisma.js";
import { slugify } from "../creator/creator-profile.service.js";

export class AdminOrganizationService {
  static async listOrganizations() {
    return prisma.organization.findMany({
      include: {
        country: true,
        _count: { select: { podcasts: true, members: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  static async createOrganization(data: { name: string; description?: string; logo?: string; website?: string; countryId?: string }) {
    let slugBase = slugify(data.name);
    let slug = slugBase;
    let count = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      count++;
      slug = `${slugBase}-${count}`;
    }

    return prisma.organization.create({
      data: {
        name: data.name,
        slug,
        description: data.description,
        logo: data.logo,
        website: data.website,
        countryId: data.countryId,
      },
      include: { country: true },
    });
  }

  static async updateOrganization(id: string, data: { name?: string; description?: string; logo?: string; website?: string; countryId?: string }) {
    return prisma.organization.update({
      where: { id },
      data,
    });
  }
}
