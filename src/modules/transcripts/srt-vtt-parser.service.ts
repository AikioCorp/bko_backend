export interface ParsedSegment {
  position: number;
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  speakerLabel?: string;
}

export class SrtVttParserService {
  static parse(content: string): ParsedSegment[] {
    if (!content || !content.trim()) return [];

    const isVtt = content.startsWith("WEBVTT");
    const blocks = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\n+/);
    const segments: ParsedSegment[] = [];
    let pos = 1;

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length < 2) continue;
      if (isVtt && lines[0].startsWith("WEBVTT")) continue;

      let timeLineIdx = 0;
      if (!lines[0].includes("-->") && lines[1] && lines[1].includes("-->")) {
        timeLineIdx = 1;
      } else if (!lines[0].includes("-->")) {
        continue;
      }

      const timeLine = lines[timeLineIdx];
      const textLines = lines.slice(timeLineIdx + 1);

      const times = timeLine.split("-->").map((s) => s.trim().split(" ")[0]);
      if (times.length < 2) continue;

      const startTimeMs = this.parseTimeMs(times[0]);
      const endTimeMs = this.parseTimeMs(times[1]);
      const rawText = textLines.join(" ").trim();

      // Speaker label extraction e.g. "Speaker 1: Bonjour"
      let speakerLabel: string | undefined = undefined;
      let cleanedText = rawText;
      const speakerMatch = rawText.match(/^([A-Za-z0-9\s_-]+):\s*(.*)/);
      if (speakerMatch) {
        speakerLabel = speakerMatch[1].trim();
        cleanedText = speakerMatch[2].trim();
      }

      if (cleanedText) {
        segments.push({
          position: pos++,
          startTimeMs,
          endTimeMs,
          text: cleanedText,
          speakerLabel,
        });
      }
    }

    return segments;
  }

  private static parseTimeMs(timeStr: string): number {
    const normalized = timeStr.replace(",", ".");
    const parts = normalized.split(":");
    let hours = 0, minutes = 0, seconds = 0;

    if (parts.length === 3) {
      hours = parseFloat(parts[0]);
      minutes = parseFloat(parts[1]);
      seconds = parseFloat(parts[2]);
    } else if (parts.length === 2) {
      minutes = parseFloat(parts[0]);
      seconds = parseFloat(parts[1]);
    }

    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }

  static exportToVtt(segments: Array<{ startTimeMs: number; endTimeMs: number; text: string; speakerLabel?: string }>): string {
    let vtt = "WEBVTT\n\n";

    segments.forEach((seg, idx) => {
      vtt += `${idx + 1}\n`;
      vtt += `${this.formatTimeVtt(seg.startTimeMs)} --> ${this.formatTimeVtt(seg.endTimeMs)}\n`;
      if (seg.speakerLabel) {
        vtt += `<v ${seg.speakerLabel}>${seg.text}\n\n`;
      } else {
        vtt += `${seg.text}\n\n`;
      }
    });

    return vtt;
  }

  private static formatTimeVtt(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const millis = ms % 1000;
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    const pad = (n: number, z = 2) => String(n).padStart(z, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
  }
}
