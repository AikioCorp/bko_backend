/**
 * Réglages d'import RSS persistés sur RssFeed.importSettings et appliqués par le worker.
 *
 * Réglages réellement pris en charge :
 *  - importScope           : ALL | LAST_10 | SELECT (périmètre de l'import INITIAL ; les nouveaux épisodes
 *                            publiés ensuite par le flux sont toujours importés)
 *  - newEpisodesTreatment  : statut donné aux épisodes créés (DRAFT | REVIEW | PUBLISHED)
 *  - keepManualEdits       : ne pas écraser un épisode modifié à la main sur Bamako Podcast
 *  - selectedGuids         : épisodes choisis lorsque importScope = SELECT
 *
 * La synchronisation automatique est portée par la colonne RssFeed.syncEnabled.
 * « Signaler les épisodes retirés du flux » n'est PAS pris en charge (aucun champ ne le stocke).
 */

export type ImportScope = "ALL" | "LAST_10" | "SELECT";
export type NewEpisodesTreatment = "DRAFT" | "REVIEW" | "PUBLISHED";

export interface RssImportSettings {
  importScope: ImportScope;
  newEpisodesTreatment: NewEpisodesTreatment;
  keepManualEdits: boolean;
  selectedGuids: string[];
}

/** Comportement historique (flux connectés depuis le Studio, avant les réglages administrateur). */
export const LEGACY_IMPORT_SETTINGS: RssImportSettings = {
  importScope: "ALL",
  newEpisodesTreatment: "PUBLISHED",
  keepManualEdits: true,
  selectedGuids: [],
};

export const LAST_N_EPISODES = 10;

const SCOPES: ImportScope[] = ["ALL", "LAST_10", "SELECT"];
const TREATMENTS: NewEpisodesTreatment[] = ["DRAFT", "REVIEW", "PUBLISHED"];

export function parseImportSettings(raw: unknown): RssImportSettings {
  if (!raw || typeof raw !== "object") return { ...LEGACY_IMPORT_SETTINGS };
  const r = raw as Record<string, unknown>;
  return {
    importScope: SCOPES.includes(r.importScope as ImportScope) ? (r.importScope as ImportScope) : "ALL",
    newEpisodesTreatment: TREATMENTS.includes(r.newEpisodesTreatment as NewEpisodesTreatment)
      ? (r.newEpisodesTreatment as NewEpisodesTreatment)
      : LEGACY_IMPORT_SETTINGS.newEpisodesTreatment,
    keepManualEdits: r.keepManualEdits === false ? false : true,
    selectedGuids: Array.isArray(r.selectedGuids) ? r.selectedGuids.filter((g) => typeof g === "string") : [],
  };
}

export function treatmentToEpisodeStatus(t: NewEpisodesTreatment): "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" {
  if (t === "DRAFT") return "DRAFT";
  if (t === "REVIEW") return "PENDING_REVIEW";
  return "PUBLISHED";
}

interface ScopedItem {
  guid: string;
  pubDate: Date | null;
}

/**
 * GUID des épisodes à importer lors de l'import initial. Les autres sont mémorisés comme « ignorés »
 * (ligne RssImportedEpisode sans épisode local) afin de ne pas être importés par les synchronisations suivantes.
 */
export function pickInitialGuids(items: ScopedItem[], settings: RssImportSettings): Set<string> {
  if (settings.importScope === "ALL") return new Set(items.map((i) => i.guid));
  if (settings.importScope === "SELECT") {
    const wanted = new Set(settings.selectedGuids);
    return new Set(items.filter((i) => wanted.has(i.guid)).map((i) => i.guid));
  }
  // LAST_10 : les plus récents par date de publication ; sans date, ordre du flux (récent en premier par convention).
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const ta = a.item.pubDate ? a.item.pubDate.getTime() : -Infinity;
    const tb = b.item.pubDate ? b.item.pubDate.getTime() : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.index - b.index;
  });
  return new Set(indexed.slice(0, LAST_N_EPISODES).map((x) => x.item.guid));
}
