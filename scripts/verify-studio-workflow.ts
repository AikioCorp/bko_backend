import { prisma } from "../src/config/prisma.js";
import { PodcastTeamService } from "../src/modules/creator/podcast-team.service.js";
import { CreatorProfileService } from "../src/modules/creator/creator-profile.service.js";
import { UserService } from "../src/modules/users/user.service.js";
import { RssParserService } from "../src/modules/rss/rss-parser.service.js";
import { PushNotificationService } from "../src/services/push-notification.service.js";
import { CreatorPodcastService } from "../src/modules/creator/creator-podcast.service.js";

interface TestReport {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const reports: TestReport[] = [];

function recordTest(name: string, passed: boolean, details?: string, error?: string) {
  reports.push({ name, passed, details, error });
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon} - ${name}${details ? ` (${details})` : ""}${error ? ` Error: ${error}` : ""}`);
}

async function runStudioVerification() {
  console.log("==================================================================");
  console.log("   STUDIO BAMAKO PODCAST - AUTOMATED END-TO-END VERIFICATION     ");
  console.log("==================================================================");

  let testOwnerUser: any = null;
  let testCollaboratorUser: any = null;
  let testPodcast: any = null;

  try {
    // 1. SETUP: Create test users and podcast
    const testOwnerEmail = `test_owner_${Date.now()}@bamakopodcast.ml`;
    const testCollabEmail = `test_collab_${Date.now()}@bamakopodcast.ml`;

    testOwnerUser = await prisma.user.create({
      data: {
        email: testOwnerEmail,
        fullName: "Test Owner Studio",
        passwordHash: "dummy_hash_for_test",
      },
    });

    testCollaboratorUser = await prisma.user.create({
      data: {
        email: testCollabEmail,
        fullName: "Test Auditeur Collaborateur",
        passwordHash: "dummy_hash_for_test",
      },
    });

    testPodcast = await prisma.podcast.create({
      data: {
        name: `Podcast Studio Test ${Date.now()}`,
        slug: `podcast-studio-test-${Date.now()}`,
        description: "Podcast de test pour la vérification du Studio",
        cover: "https://bamakopodcast.ml/covers/test.jpg",
        countryId: "ML",
        primaryLanguageCode: "fr",
        status: "DRAFT",
        creationSource: "CREATOR",
      },
    });

    // Seed User A as the INITIAL OWNER
    await prisma.podcastMember.create({
      data: {
        podcastId: testPodcast.id,
        userId: testOwnerUser.id,
        role: "OWNER",
      },
    });

    recordTest(
      "Initialisation de l'environnement de test",
      true,
      `Podcast: ${testPodcast.id}, Owner: ${testOwnerUser.id}, Collab: ${testCollaboratorUser.id}`
    );

    // 2. TEST: Verify initial studio access for the collaborator
    const initialAccess = await CreatorProfileService.getStudioAccess(testCollaboratorUser.id);
    const initialMe = await UserService.getMe(testCollaboratorUser.id);
    recordTest(
      "Auditeur standard n'a pas accès initial au Studio",
      initialAccess.canAccess === false && initialMe.hasStudioAccess === false && initialMe.isCollaborator === false,
      `canAccess = ${initialAccess.canAccess}, isCollaborator = ${initialMe.isCollaborator}`
    );

    // 3. TEST: Direct Addition of Existing User (RÈGLE MÉTIER PRIORITAIRE - AJOUT DIRECT SANS ACCEPTATION)
    const addResult = await PodcastTeamService.directAddMember(
      testOwnerUser.id,
      testPodcast.id,
      {
        userId: testCollaboratorUser.id,
        role: "EDITOR",
      }
    );

    recordTest(
      "Ajout administratif direct d'un utilisateur existant (Succès immédiat sans invitation)",
      addResult.success === true && addResult.alreadyMember === false,
      `role = ${addResult.member?.role}, message = "${addResult.message}"`
    );

    // 3b. Verify Database Membership State
    const memberRecord = await prisma.podcastMember.findFirst({
      where: {
        podcastId: testPodcast.id,
        userId: testCollaboratorUser.id,
      },
    });

    recordTest(
      "Membre immédiatement actif dans la table podcastMember",
      memberRecord !== null && memberRecord.role === "EDITOR",
      `role = ${memberRecord?.role}`
    );

    // 3c. Verify Audit Log
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        actorId: testOwnerUser.id,
        action: "PODCAST_MEMBER_DIRECT_ADDED",
      },
      orderBy: { id: "desc" },
    });

    recordTest(
      "Audit log créé lors de l'ajout (PODCAST_MEMBER_DIRECT_ADDED)",
      auditRecord !== null && (auditRecord.newState as any)?.targetUserId === testCollaboratorUser.id,
      `action = ${auditRecord?.action}`
    );

    // 3d. Verify Persisted Notification with Action Button "Ouvrir l'émission"
    const notifRecord = await prisma.notification.findFirst({
      where: {
        userId: testCollaboratorUser.id,
        type: "TEAM_MEMBER_ADDED",
      },
      orderBy: { createdAt: "desc" },
    });

    const notifValid =
      notifRecord !== null &&
      notifRecord.link === `/studio/podcasts/${testPodcast.id}`;

    recordTest(
      "Notification persistée créée avec lien Studio (/studio/podcasts/:id)",
      notifValid,
      `link = ${notifRecord?.link}`
    );

    // 3e. Verify Push Notification Outbox Job Enqueued
    const pushJob = await prisma.jobQueueItem.findFirst({
      where: {
        queueName: "push_notifications",
      },
      orderBy: { createdAt: "desc" },
    });

    const isJobForUser =
      pushJob &&
      Array.isArray((pushJob.payload as any)?.userIds) &&
      (pushJob.payload as any).userIds.includes(testCollaboratorUser.id);

    recordTest(
      "Outbox push persistante enfilée dans jobQueueItem avec route Studio",
      Boolean(isJobForUser),
      `queueName = ${pushJob?.queueName}, status = ${pushJob?.status}, route = ${(pushJob?.payload as any)?.route}`
    );

    // 4. TEST: Immediate Rights Refresh (Collaborator now has Studio Access without re-login)
    const refreshedAccess = await CreatorProfileService.getStudioAccess(testCollaboratorUser.id);
    const refreshedMe = await UserService.getMe(testCollaboratorUser.id);
    const creatorPodcasts = await prisma.podcast.findMany({
      where: {
        members: {
          some: { userId: testCollaboratorUser.id },
        },
      },
    });

    recordTest(
      "Droits actualisés immédiatement (hasStudioAccess = true, isCollaborator = true, émission visible)",
      refreshedAccess.canAccess === true &&
        refreshedMe.hasStudioAccess === true &&
        refreshedMe.isCollaborator === true &&
        creatorPodcasts.some((p) => p.id === testPodcast.id),
      `hasStudioAccess = ${refreshedMe.hasStudioAccess}, isCollaborator = ${refreshedMe.isCollaborator}, podcastsCount = ${creatorPodcasts.length}`
    );

    // 5. TEST: Idempotent re-add
    const idempotentResult = await PodcastTeamService.directAddMember(
      testOwnerUser.id,
      testPodcast.id,
      {
        userId: testCollaboratorUser.id,
        role: "EDITOR",
      }
    );

    recordTest(
      "Ajout idempotent d'un membre déjà présent avec le même rôle",
      idempotentResult.success === true && idempotentResult.alreadyMember === true,
      `alreadyMember = ${idempotentResult.alreadyMember}`
    );

    // 5b. Prevent Silent Role Change on Direct Add (must use updateMemberRole)
    let caughtSilentRoleChange = false;
    try {
      await PodcastTeamService.directAddMember(
        testOwnerUser.id,
        testPodcast.id,
        {
          userId: testCollaboratorUser.id,
          role: "ADMIN",
        }
      );
    } catch (e: any) {
      caughtSilentRoleChange = e.message === "MEMBER_ALREADY_EXISTS_WITH_ROLE";
    }

    recordTest(
      "Empêche la réécriture silencieuse du rôle lors d'un simple ajout (MEMBER_ALREADY_EXISTS_WITH_ROLE)",
      caughtSilentRoleChange,
      "Exige l'action explicite de modification de rôle"
    );

    // 6. TEST: Explicit Role Modification
    const updateRoleResult = await PodcastTeamService.updateMemberRole(
      testOwnerUser.id,
      testPodcast.id,
      testCollaboratorUser.id,
      "ADMIN"
    );

    const updatedRecord = await prisma.podcastMember.findFirst({
      where: { podcastId: testPodcast.id, userId: testCollaboratorUser.id },
    });

    recordTest(
      "Modification explicite du rôle du membre en ADMIN",
      updateRoleResult.role === "ADMIN" && updatedRecord?.role === "ADMIN",
      `nouveau role = ${updatedRecord?.role}`
    );

    // 7. TEST: Protection of Last Owner (RÈGLE DE SÉCURITÉ MAJEURE)
    let caughtLastOwnerError = false;
    try {
      await PodcastTeamService.removeMember(testOwnerUser.id, testPodcast.id, testOwnerUser.id);
    } catch (e: any) {
      caughtLastOwnerError = e.message === "CANNOT_REMOVE_OWNER";
    }

    recordTest(
      "Protection du dernier propriétaire contre la suppression (CANNOT_REMOVE_OWNER)",
      caughtLastOwnerError,
      "Empêche la suppression du dernier OWNER"
    );

    // 7b. Attempt to downgrade the last owner
    let caughtDowngradeError = false;
    let downgradeErrorMessage = "";
    try {
      await PodcastTeamService.updateMemberRole(testOwnerUser.id, testPodcast.id, testOwnerUser.id, "EDITOR");
    } catch (e: any) {
      caughtDowngradeError = e.message === "CANNOT_REMOVE_OWNER" || e.message === "CANNOT_EDIT_SELF";
      downgradeErrorMessage = e.message;
    }

    recordTest(
      "Protection contre la rétrogradation du dernier propriétaire (CANNOT_REMOVE_OWNER / CANNOT_EDIT_SELF)",
      caughtDowngradeError,
      `Empêche de modifier le dernier OWNER (${downgradeErrorMessage})`
    );

    // 8. TEST: Member Removal & Rights Revocation
    const removeResult = await PodcastTeamService.removeMember(
      testOwnerUser.id,
      testPodcast.id,
      testCollaboratorUser.id
    );

    const memberAfterRemoval = await prisma.podcastMember.findFirst({
      where: { podcastId: testPodcast.id, userId: testCollaboratorUser.id },
    });

    const accessAfterRemoval = await CreatorProfileService.getStudioAccess(testCollaboratorUser.id);
    const meAfterRemoval = await UserService.getMe(testCollaboratorUser.id);

    recordTest(
      "Retrait du membre et révocation immédiate des accès Studio",
      removeResult !== null &&
        memberAfterRemoval === null &&
        accessAfterRemoval.canAccess === false &&
        meAfterRemoval.hasStudioAccess === false,
      `memberExists = ${memberAfterRemoval !== null}, hasStudioAccess = ${meAfterRemoval.hasStudioAccess}`
    );

    // 9. TEST: RSS Standalone XML Parse & Preview without Pre-existing Podcast
    try {
      const xmlFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Bamako Tech Talks</title>
    <description>Le podcast de la tech au Mali</description>
    <itunes:image href="https://bamakotech.ml/cover.jpg"/>
    <item>
      <title>Épisode 1: Bienvenue à Bamako</title>
      <description>Introduction au podcast</description>
      <enclosure url="https://bamakotech.ml/ep1.mp3" length="12345" type="audio/mpeg"/>
    </item>
  </channel>
</rss>`;

      const parsedPreview = RssParserService.parseXml(xmlFeed);
      const isRssValid =
        parsedPreview &&
        parsedPreview.title === "Bamako Tech Talks" &&
        Array.isArray(parsedPreview.items) &&
        parsedPreview.items.length === 1;

      recordTest(
        "Analyse de flux RSS autonome (sans émission préexistante requise)",
        Boolean(isRssValid),
        `titre = "${parsedPreview?.title}", épisodes détectés = ${parsedPreview?.items?.length}`
      );
    } catch (e: any) {
      recordTest("Analyse de flux RSS autonome", false, undefined, e.message);
    }

    // 10. TEST: Création d'émission sans profil créateur préalable (auto-activation)
    let freshCreatedPodcast: any = null;
    let freshUser: any = null;
    try {
      const freshEmail = `fresh_creator_${Date.now()}@bamakopodcast.ml`;
      freshUser = await prisma.user.create({
        data: {
          email: freshEmail,
          fullName: "Nouveau Créateur Sans Profil",
          passwordHash: "dummy_hash",
        },
      });

      // User has 0 podcasts and NO CreatorProfile row
      freshCreatedPodcast = await CreatorPodcastService.createPodcast(freshUser.id, {
        name: `Podcast Auto Activé ${Date.now()}`,
        description: "Podcast créé directement depuis l'analyse YouTube/RSS sans émission préalable",
        cover: "https://bamakopodcast.ml/covers/auto.jpg",
        countryId: "ML",
        primaryLanguageCode: "fr",
      });

      const member = await prisma.podcastMember.findUnique({
        where: { podcastId_userId: { podcastId: freshCreatedPodcast.id, userId: freshUser.id } },
      });

      const createdProfile = await prisma.creatorProfile.findUnique({
        where: { userId: freshUser.id },
      });

      recordTest(
        "Création d'émission directe sans profil préalable (auto-activation)",
        Boolean(freshCreatedPodcast?.id && member?.role === "OWNER" && createdProfile?.id),
        `Podcast: ${freshCreatedPodcast?.id}, Profil créateur créé: ${createdProfile?.id}, Rôle: ${member?.role}`
      );
    } catch (e: any) {
      recordTest("Création d'émission directe sans profil préalable", false, undefined, e.message);
    } finally {
      if (freshCreatedPodcast?.id) {
        await prisma.podcastMember.deleteMany({ where: { podcastId: freshCreatedPodcast.id } }).catch(() => {});
        await prisma.podcast.delete({ where: { id: freshCreatedPodcast.id } }).catch(() => {});
      }
      if (freshUser?.id) {
        await prisma.creatorProfile.deleteMany({ where: { userId: freshUser.id } }).catch(() => {});
        await prisma.userRole.deleteMany({ where: { userId: freshUser.id } }).catch(() => {});
        await prisma.user.delete({ where: { id: freshUser.id } }).catch(() => {});
      }
    }

    // 11. TEST: Push Infrastructure Diagnostics
    const pushDiag = await PushNotificationService.getDiagnostics();
    recordTest(
      "Diagnostic de l'infrastructure Push (Firebase FCM, Outbox queue)",
      pushDiag !== null && pushDiag.provider === "FIREBASE_FCM",
      `Status: ${pushDiag.configurationStatus}, Active tokens: ${pushDiag.metrics.activeTokens}, Pending jobs: ${pushDiag.metrics.pendingPushJobs}`
    );

  } catch (error: any) {
    recordTest("Exécution globale des tests", false, undefined, error.message);
    console.error("Erreur fatale de test:", error);
  } finally {
    // CLEANUP
    if (testPodcast?.id) {
      await prisma.podcastMember.deleteMany({ where: { podcastId: testPodcast.id } }).catch(() => {});
      await prisma.podcast.delete({ where: { id: testPodcast.id } }).catch(() => {});
    }
    if (testOwnerUser?.id) {
      await prisma.auditLog.deleteMany({ where: { actorId: testOwnerUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testOwnerUser.id } }).catch(() => {});
    }
    if (testCollaboratorUser?.id) {
      await prisma.notification.deleteMany({ where: { userId: testCollaboratorUser.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: testCollaboratorUser.id } }).catch(() => {});
    }
  }

  console.log("==================================================================");
  const total = reports.length;
  const passed = reports.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`RÉSULTAT FINAL: ${passed}/${total} TESTS RÉUSSIS (${failed} ÉCHECS)`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runStudioVerification().catch((e) => {
  console.error("Unhandled error in test runner:", e);
  process.exit(1);
});
