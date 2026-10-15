export function formatEpisodeWithMediaFlags(episode: any) {
  if (!episode) return episode;

  const mediaSources = episode.mediaSources || [];
  const audioAvailable = mediaSources.some((s: any) => s.type === "AUDIO");
  const videoAvailable = mediaSources.some((s: any) => s.type === "VIDEO");

  const primaryAudioSource =
    mediaSources.find((s: any) => s.isPrimaryAudio) ||
    mediaSources.find((s: any) => s.type === "AUDIO") ||
    null;

  const primaryVideoSource =
    mediaSources.find((s: any) => s.isPrimaryVideo) ||
    mediaSources.find((s: any) => s.type === "VIDEO") ||
    null;

  const defaultMode = audioAvailable ? "AUDIO" : "VIDEO";

  // Extraction de la pochette vidéo
  let videoCover: string | null = null;
  if (primaryVideoSource) {
    if (primaryVideoSource.provider === "YOUTUBE" && primaryVideoSource.externalId) {
      videoCover = `https://i1.ytimg.com/vi/${primaryVideoSource.externalId}/hqdefault.jpg`;
    } else if (primaryVideoSource.mediaAsset?.thumbnailUrl) {
      videoCover = primaryVideoSource.mediaAsset.thumbnailUrl;
    }
  }
  if (!videoCover && (episode.creationSource === "EXTERNAL_IMPORT" || !audioAvailable)) {
    videoCover = episode.cover || null;
  }

  // Extraction de la pochette audio
  const audioCover: string | null =
    episode.audioCover ||
    (episode.creationSource === "RSS_IMPORT" || episode.creationSource === "CREATOR" ? episode.cover : null) ||
    episode.podcast?.cover ||
    null;

  // Règle de dominance Bko :
  // Quand il y a vidéo ET audio, la pochette de l'audio est dominante, sinon celle de la vidéo le cas échéant.
  let dominantCover: string | null = episode.cover || null;
  let dominantCoverType: "AUDIO" | "VIDEO" = "AUDIO";

  if (audioAvailable && videoAvailable) {
    if (audioCover) {
      dominantCover = audioCover;
      dominantCoverType = "AUDIO";
    } else if (videoCover) {
      dominantCover = videoCover;
      dominantCoverType = "VIDEO";
    } else {
      dominantCover = episode.cover || episode.podcast?.cover || null;
    }
  } else if (audioAvailable) {
    dominantCover = audioCover || episode.cover || episode.podcast?.cover || null;
    dominantCoverType = "AUDIO";
  } else if (videoAvailable) {
    dominantCover = videoCover || episode.cover || episode.podcast?.cover || null;
    dominantCoverType = "VIDEO";
  } else {
    dominantCover = episode.cover || episode.podcast?.cover || null;
  }

  return {
    ...episode,
    cover: dominantCover,
    effectiveCover: dominantCover,
    audioCover,
    videoCover,
    dominantCoverType,
    audioAvailable,
    videoAvailable,
    defaultMode,
    primaryAudioSource,
    primaryVideoSource,
  };
}
