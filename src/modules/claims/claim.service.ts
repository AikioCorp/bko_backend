import { prisma } from "../../config/prisma.js";
import { AuditService } from "../../services/audit.service.js";
import { ClaimStatus, VerificationMethod, PodcastOwnershipStatus, PodcastMemberRole } from "@prisma/client";

export class ClaimService {
  static async submitClaim(
    userId: string,
    data: {
      podcastId: string;
      proofDescription: string;
      proofDocumentUrl?: string;
      verificationMethod?: VerificationMethod;
    }
  ) {
    const podcast = await prisma.podcast.findUnique({ where: { id: data.podcastId } });
    if (!podcast) throw new Error("PODCAST_NOT_FOUND");

    // Vérifier si une revendication active (PENDING ou UNDER_REVIEW) existe déjà pour cet utilisateur et ce podcast
    const existingActiveClaim = await prisma.claim.findFirst({
      where: {
        userId,
        podcastId: data.podcastId,
        status: { in: ["PENDING", "UNDER_REVIEW"] },
      },
    });

    if (existingActiveClaim) {
      throw new Error("CLAIM_ALREADY_SUBMITTED");
    }

    const claim = await prisma.claim.create({
      data: {
        userId,
        podcastId: data.podcastId,
        proofDescription: data.proofDescription,
        proofDocumentUrl: data.proofDocumentUrl,
        verificationMethod: data.verificationMethod || "MANUAL",
        status: ClaimStatus.PENDING,
      },
      include: { podcast: true },
    });

    return claim;
  }

  static async getUserClaims(userId: string) {
    return prisma.claim.findMany({
      where: { userId },
      include: {
        podcast: { include: { country: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getAdminClaims(status?: ClaimStatus) {
    return prisma.claim.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, fullName: true, email: true, avatar: true } },
        podcast: { include: { country: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static async reviewClaim(adminUserId: string, claimId: string, status: ClaimStatus, reviewNotes?: string) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: { podcast: true },
    });

    if (!claim) throw new Error("CLAIM_NOT_FOUND");

    return prisma.$transaction(async (tx) => {
      const updatedClaim = await tx.claim.update({
        where: { id: claimId },
        data: {
          status,
          reviewNotes,
        },
      });

      if (status === ClaimStatus.APPROVED) {
        // 1. Basculer le statut d'appartenance du podcast en CLAIMED
        await tx.podcast.update({
          where: { id: claim.podcastId },
          data: {
            ownershipStatus: PodcastOwnershipStatus.CLAIMED,
            managedByBamakoPodcast: false,
          },
        });

        // 2. Définir l'utilisateur demandeur comme OWNER du podcast
        await tx.podcastMember.upsert({
          where: { podcastId_userId: { podcastId: claim.podcastId, userId: claim.userId } },
          update: { role: PodcastMemberRole.OWNER },
          create: {
            podcastId: claim.podcastId,
            userId: claim.userId,
            role: PodcastMemberRole.OWNER,
          },
        });
      }

      await AuditService.logAction({
        actorId: adminUserId,
        action: status === ClaimStatus.APPROVED ? "CLAIM_APPROVED" : "CLAIM_REJECTED",
        entityType: "CLAIM",
        entityId: claimId,
        previousState: { status: claim.status },
        newState: { status, reviewNotes },
      });

      return updatedClaim;
    });
  }
}
