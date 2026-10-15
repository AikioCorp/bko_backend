async function fetchChannelVideosTab(channelId, customUrl) {
  const targetUrl = customUrl ? `${customUrl.replace(/\/+$/, "")}/videos` : `https://www.youtube.com/channel/${channelId}/videos`;
  console.log("Fetching targetUrl:", targetUrl);

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
    }
  });

  const html = await res.text();
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
  if (!match) return [];

  const data = JSON.parse(match[1]);
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find((t) => t.tabRenderer?.title === "Vidéos" || t.tabRenderer?.title === "Videos");
  const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

  const videos = [];
  let continuationToken = null;

  for (const c of contents) {
    if (c.continuationItemRenderer) {
      continuationToken = c.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      continue;
    }

    const lockup = c.richItemRenderer?.content?.lockupViewModel;
    if (lockup && lockup.contentId) {
      const vid = lockup.contentId;
      const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
      const thumb = lockup.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vid}/hqdefault.jpg`;
      const timeOverlay = lockup.contentImage?.thumbnailViewModel?.overlays?.find(o => o.thumbnailOverlayTimeStatusRenderer);
      const durationLabel = timeOverlay?.thumbnailOverlayTimeStatusRenderer?.text?.content || "";

      videos.push({
        videoId: vid,
        title,
        thumbnailUrl: thumb,
        durationLabel,
        isLikelyShort: false,
      });
    } else if (c.richItemRenderer?.content?.videoRenderer) {
      const vr = c.richItemRenderer.content.videoRenderer;
      videos.push({
        videoId: vr.videoId,
        title: vr.title?.runs?.[0]?.text || "",
        thumbnailUrl: vr.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`,
        durationLabel: vr.lengthText?.simpleText || "",
        isLikelyShort: false,
      });
    }
  }

  // Si on a un continuationToken, faire un appel pour charger 30 vidéos supplémentaires
  if (continuationToken) {
    try {
      const contRes = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        body: JSON.stringify({
          continuation: continuationToken,
          context: { client: { clientName: "WEB", clientVersion: "2.20231201.00.00" } }
        })
      });
      if (contRes.ok) {
        const contData = await contRes.json();
        const actions = contData.onResponseReceivedActions || [];
        const contItems = actions[0]?.appendContinuationItemsAction?.continuationItems || [];
        for (const c of contItems) {
          const lockup = c.richItemRenderer?.content?.lockupViewModel;
          if (lockup && lockup.contentId) {
            const vid = lockup.contentId;
            const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
            const thumb = lockup.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://i1.ytimg.com/vi/${vid}/hqdefault.jpg`;
            const timeOverlay = lockup.contentImage?.thumbnailViewModel?.overlays?.find(o => o.thumbnailOverlayTimeStatusRenderer);
            const durationLabel = timeOverlay?.thumbnailOverlayTimeStatusRenderer?.text?.content || "";

            videos.push({
              videoId: vid,
              title,
              thumbnailUrl: thumb,
              durationLabel,
              isLikelyShort: false,
            });
          }
        }
      }
    } catch (e) {
      console.warn("Continuation fetch failed:", e.message);
    }
  }

  return videos;
}

fetchChannelVideosTab("UCsTXwX8OTIn8Fmpj1l11Yaw", "https://www.youtube.com/@dariftonprod").then(v => {
  console.log("Success! Total videos retrieved:", v.length);
  console.log("First 3:", v.slice(0, 3));
  console.log("Last 3:", v.slice(-3));
});
