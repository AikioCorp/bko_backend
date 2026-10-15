async function test() {
  const url = "https://www.youtube.com/@dariftonprod/videos";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
    }
  });
  const html = await res.text();
  const match = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData\s*=\s*({.+?});/s);
  const data = JSON.parse(match[1]);
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find((t) => t.tabRenderer?.title === "Vidéos" || t.tabRenderer?.title === "Videos");
  const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

  const lastItem = contents[contents.length - 1];
  const token = lastItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  console.log("Found continuation token:", !!token);

  if (token) {
    const postRes = await fetch("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      body: JSON.stringify({
        continuation: token,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20231201.00.00"
          }
        }
      })
    });
    const postData = await postRes.json();
    console.log("Continuation API status:", postRes.status);
    const actions = postData.onResponseReceivedActions || [];
    console.log("Actions count:", actions.length);
    const appendedItems = actions[0]?.appendContinuationItemsAction?.continuationItems || [];
    console.log("Appended items count:", appendedItems.length);
  }
}

test().catch(console.error);
