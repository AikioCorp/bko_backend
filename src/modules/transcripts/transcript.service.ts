import { prisma } from "../../config/prisma.js";
import { SrtVttParserService } from "./srt-vtt-parser.service.js";
import { TranscriptStatus, TranscriptVisibility, TranscriptType, TranscriptSource, ChapterSource } from "@prisma/client";

export class TranscriptService {
  static async getPublicTranscript(episodeId: string) {
    const transcript = await prisma.transcript.findFirst({
      where: {
        episodeId,
        visibility: "PUBLIC",
        status: "READY",
        episode: { status: "PUBLISHED" }, // jamais la transcription d'un brouillon
      },
      include: {
        segments: { orderBy: { position: "asc" } },
        speakers: { include: { person: true } },
        language: true,
      },
      orderBy: { isPrimary: "desc" },
    });
    return transcript;
  }

  static async getChapters(episodeId: string) {
    return prisma.episodeChapter.findMany({
      where: { episodeId, episode: { status: "PUBLISHED" } },
      orderBy: { position: "asc" },
    });
  }

  static async searchEpisodeTranscript(episodeId: string, query: string) {
    if (!query || !query.trim()) return [];

    const segments = await prisma.transcriptSegment.findMany({
      where: {
        transcript: { episodeId, visibility: "PUBLIC", status: "READY", episode: { status: "PUBLISHED" } },
        text: { contains: query.trim(), mode: "insensitive" },
      },
      orderBy: { startTimeMs: "asc" },
      take: 20,
    });

    return segments.map((s) => ({
      segmentId: s.id,
      startTimeMs: s.startTimeMs,
      endTimeMs: s.endTimeMs,
      text: s.text,
      speakerLabel: s.speakerLabel,
      formattedTime: this.formatTime(s.startTimeMs),
    }));
  }

  static async importSubtitles(userId: string, episodeId: string, fileContent: string, languageCode = "fr") {
    const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    const parsedSegments = SrtVttParserService.parse(fileContent);
    if (parsedSegments.length === 0) throw new Error("INVALID_TRANSCRIPT_FILE");

    return prisma.$transaction(async (tx) => {
      // Désactiver le marquage isPrimary des transcripts existants
      await tx.transcript.updateMany({
        where: { episodeId, isPrimary: true },
        data: { isPrimary: false },
      });

      const transcript = await tx.transcript.create({
        data: {
          episodeId,
          languageCode,
          type: TranscriptType.ORIGINAL,
          status: TranscriptStatus.READY,
          source: TranscriptSource.IMPORTED,
          visibility: TranscriptVisibility.PUBLIC,
          isPrimary: true,
          isReviewed: true,
          completedAt: new Date(),
          segments: {
            create: parsedSegments.map((s) => ({
              position: s.position,
              startTimeMs: s.startTimeMs,
              endTimeMs: s.endTimeMs,
              text: s.text,
              speakerLabel: s.speakerLabel,
            })),
          },
        },
        include: {
          segments: { orderBy: { position: "asc" } },
        },
      });

      return transcript;
    });
  }

  static async generateTranscript(userId: string, episodeId: string, languageCode = "fr") {
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { mediaSources: true },
    });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    if (episode.mediaSources.length === 0) throw new Error("VALIDATION_ERROR_NO_MEDIA_SOURCE");

    // Créer le modèle Transcript en statut PENDING
    const transcript = await prisma.transcript.create({
      data: {
        episodeId,
        languageCode,
        type: TranscriptType.ORIGINAL,
        status: TranscriptStatus.PENDING,
        source: TranscriptSource.AUTO_GENERATED,
        visibility: TranscriptVisibility.PRIVATE,
        provider: "MockTranscriptionProvider",
      },
    });

    // Enclencher la tâche en arrière-plan
    await prisma.jobQueueItem.create({
      data: {
        queueName: "media-processing",
        jobType: "TRANSCRIPT_GENERATE",
        payload: {
          transcriptId: transcript.id,
          episodeId,
          languageCode,
        },
      },
    });

    return transcript;
  }

  static async updateSegment(userId: string, segmentId: string, text: string, speakerLabel?: string) {
    const segment = await prisma.transcriptSegment.findUnique({
      where: { id: segmentId },
      include: { transcript: { include: { episode: true } } },
    });
    if (!segment) throw new Error("SEGMENT_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: segment.transcript.episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    await prisma.transcript.update({
      where: { id: segment.transcriptId },
      data: { isReviewed: true, lastEditedBy: userId },
    });

    return prisma.transcriptSegment.update({
      where: { id: segmentId },
      data: { text, speakerLabel },
    });
  }

  static async updateChapters(
    userId: string,
    episodeId: string,
    chapters: Array<{ title: string; description?: string; startTimeMs: number; endTimeMs?: number; position: number }>
  ) {
    const episode = await prisma.episode.findUnique({ where: { id: episodeId } });
    if (!episode) throw new Error("EPISODE_NOT_FOUND");

    const member = await prisma.podcastMember.findUnique({
      where: { podcastId_userId: { podcastId: episode.podcastId, userId } },
    });
    if (!member || member.role === "ANALYST") throw new Error("FORBIDDEN");

    return prisma.$transaction(async (tx) => {
      await tx.episodeChapter.deleteMany({ where: { episodeId } });

      return tx.episodeChapter.createMany({
        data: chapters.map((c) => ({
          episodeId,
          title: c.title,
          description: c.description,
          startTimeMs: c.startTimeMs,
          endTimeMs: c.endTimeMs,
          position: c.position,
          source: ChapterSource.MANUAL,
        })),
      });
    });
  }

  private static formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
}
