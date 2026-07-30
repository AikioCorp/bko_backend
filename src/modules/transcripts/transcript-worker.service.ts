import { prisma } from "../../config/prisma.js";
import { MockTranscriptionProvider, OpenAIWhisperProvider, TranscriptionProvider } from "./transcription-provider.interface.js";
import { TranscriptStatus, ChapterSource, SuggestionType } from "@prisma/client";

export class TranscriptWorkerService {
  private static getProvider(): TranscriptionProvider {
    const isProduction = process.env.NODE_ENV === "production";
    const providerType = process.env.TRANSCRIPTION_PROVIDER || "mock";

    if (isProduction && (providerType === "mock" || !process.env.OPENAI_API_KEY)) {
      throw new Error("PRODUCTION_MOCK_PROVIDER_NOT_ALLOWED: En production, un fournisseur de transcription IA réel (OpenAI Whisper / Deepgram) doit être configuré.");
    }

    if (providerType === "openai" || process.env.OPENAI_API_KEY) {
      return new OpenAIWhisperProvider();
    }

    return new MockTranscriptionProvider();
  }

  static async processNextJob(): Promise<boolean> {
    const job = await prisma.$transaction(async (tx) => {
      const pending = await tx.jobQueueItem.findFirst({
        where: {
          status: "PENDING",
          queueName: "media-processing",
          jobType: "TRANSCRIPT_GENERATE",
          runAt: { lte: new Date() },
        },
        orderBy: { runAt: "asc" },
      });

      if (!pending) return null;

      return tx.jobQueueItem.update({
        where: { id: pending.id },
        data: {
          status: "PROCESSING",
          lockedAt: new Date(),
          lockedBy: "transcript-worker-1",
          attempts: { increment: 1 },
        },
      });
    });

    if (!job) return false;

    try {
      const payload = job.payload as any;
      await this.handleTranscriptGenerate(payload.transcriptId, payload.episodeId, payload.languageCode);

      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: { status: "COMPLETED" },
      });
    } catch (error: any) {
      await prisma.jobQueueItem.update({
        where: { id: job.id },
        data: {
          status: job.attempts >= job.maxAttempts ? "FAILED" : "PENDING",
          lastError: error.message || "Erreur de génération de transcription",
        },
      });
    }

    return true;
  }

  private static async handleTranscriptGenerate(transcriptId: string, episodeId: string, languageCode: string) {
    const transcript = await prisma.transcript.findUnique({ where: { id: transcriptId } });
    if (!transcript) return;

    const provider = this.getProvider();

    try {
      const { externalJobId } = await provider.submit("https://bamakopodcast.studio/media.mp3", languageCode);
      const result = await provider.getStatus(externalJobId);

      await prisma.$transaction(async (tx) => {
        let pos = 1;
        for (const seg of result.segments) {
          await tx.transcriptSegment.create({
            data: {
              transcriptId,
              position: pos++,
              startTimeMs: seg.startTimeMs,
              endTimeMs: seg.endTimeMs,
              text: seg.text,
              speakerLabel: seg.speakerLabel,
            },
          });
        }

        if (result.speakers) {
          for (const spk of result.speakers) {
            await tx.transcriptSpeaker.create({
              data: {
                transcriptId,
                label: spk.label,
                displayName: spk.displayName,
              },
            });
          }
        }

        if (result.suggestedChapters && result.suggestedChapters.length > 0) {
          const existingChapters = await tx.episodeChapter.count({ where: { episodeId } });
          if (existingChapters === 0) {
            let chPos = 1;
            for (const ch of result.suggestedChapters) {
              await tx.episodeChapter.create({
                data: {
                  episodeId,
                  title: ch.title,
                  startTimeMs: ch.startTimeMs,
                  position: chPos++,
                  source: ChapterSource.AUTO_GENERATED,
                },
              });
            }
          }
        }

        if (result.suggestedTopics) {
          for (const topicName of result.suggestedTopics) {
            await tx.contentSuggestion.create({
              data: {
                episodeId,
                type: SuggestionType.TOPIC,
                source: "TRANSCRIPTION_AI",
                payload: { topicName },
              },
            });
          }
        }

        await tx.transcript.update({
          where: { id: transcriptId },
          data: {
            status: TranscriptStatus.READY,
            visibility: "PUBLIC",
            completedAt: new Date(),
          },
        });
      });
    } catch (error: any) {
      await prisma.transcript.update({
        where: { id: transcriptId },
        data: {
          status: TranscriptStatus.FAILED,
          errorMessage: error.message || "Erreur de transcription",
        },
      });
      throw error;
    }
  }
}
