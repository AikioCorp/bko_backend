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

  return {
    ...episode,
    audioAvailable,
    videoAvailable,
    defaultMode,
    primaryAudioSource,
    primaryVideoSource,
  };
}
