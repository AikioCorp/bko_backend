import { prisma } from "../config/prisma.js";
import { FeatureFlags } from "../config/feature-flags.js";

const STAFF_ROLES = ["EDITOR", "ADMIN", "SUPER_ADMIN"];

export class ContentReviewService {
  /**
   * La validation préalable ne s'applique qu'aux créateurs "ordinaires" :
   * l'équipe éditoriale/admin et les créateurs vérifiés ("de confiance") publient directement.
   */
  static async requiresReview(userId: string): Promise<boolean> {
    if (!FeatureFlags.requireContentReview) return false;

    const [roles, profile] = await Promise.all([
      prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
      prisma.creatorProfile.findUnique({ where: { userId }, select: { isVerified: true } }),
    ]);
    if (roles.some((r) => STAFF_ROLES.includes(r.role.name.toUpperCase()))) return false;
    return !profile?.isVerified;
  }
}
