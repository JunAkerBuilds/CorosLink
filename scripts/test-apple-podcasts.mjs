import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const serviceUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "applePodcastsService.js"),
);
const queueUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "downloadQueue.js"),
);
const progressUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "downloadProgress.js"),
);

const {
  APPLE_PODCAST_PAGE_SIZE,
  getApplePodcastStorefront,
  loadApplePodcast,
  parseApplePodcastRss,
  parseDurationSeconds,
  resolveApplePodcastInput,
  searchApplePodcasts,
} = await import(`${serviceUrl.href}?cacheBust=${Date.now()}`);
const { createQueuedJob } = await import(`${queueUrl.href}?cacheBust=${Date.now()}`);
const { computeOverallProgress } = await import(
  `${progressUrl.href}?cacheBust=${Date.now()}`,
);

assert.equal(getApplePodcastStorefront("en-CA"), "CA");
assert.equal(getApplePodcastStorefront("fr"), "US");
assert.deepEqual(
  resolveApplePodcastInput(
    "https://podcasts.apple.com/ca/podcast/trail-stories/id12345",
    "US",
  ),
  { collectionId: "12345", storefront: "CA" },
);
assert.deepEqual(resolveApplePodcastInput("12345", "CA"), {
  collectionId: "12345",
  storefront: "CA",
});
assert.throws(
  () => resolveApplePodcastInput("https://example.com/podcast/id12345"),
  /podcasts\.apple\.com/,
);

assert.equal(parseDurationSeconds("3723"), 3723);
assert.equal(parseDurationSeconds("1:02:03"), 3723);
assert.equal(parseDurationSeconds("03:42"), 222);
assert.equal(parseDurationSeconds("1:90"), undefined);

const feedItems = [
  `<item>
    <guid>episode-1</guid>
    <title>First &amp; Fast</title>
    <itunes:summary><![CDATA[<p>A <strong>great</strong> run.</p>]]></itunes:summary>
    <pubDate>Wed, 6 Jul 2022 13:00:00 -0700</pubDate>
    <itunes:duration>1:02:03</itunes:duration>
    <itunes:season>2</itunes:season>
    <itunes:episode>7</itunes:episode>
    <itunes:image href="https://cdn.example.test/episode-1.jpg" />
    <enclosure url="https://cdn.example.test/episode-1.mp3" length="5650889" type="audio/mpeg" />
  </item>`,
  `<item><guid>duplicate</guid><title>Duplicate</title><enclosure url="https://cdn.example.test/episode-1.mp3" type="audio/mpeg" /></item>`,
  `<item><guid>not-public</guid><title>Not public</title><enclosure url="ftp://cdn.example.test/private.mp3" type="audio/mpeg" /></item>`,
];

for (let index = 2; index <= 51; index += 1) {
  feedItems.push(
    `<item><guid>episode-${index}</guid><title>Episode ${index}</title><enclosure url="https://cdn.example.test/episode-${index}.m4a" type="audio/mp4" /></item>`,
  );
}

const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Trail Stories RSS</title>
    <itunes:author>Trail Team</itunes:author>
    <description><![CDATA[<p>Public <em>trail</em> episodes.</p>]]></description>
    <itunes:image href="https://cdn.example.test/show.jpg" />
    ${feedItems.join("\n")}
  </channel>
</rss>`;

const show = {
  id: "12345",
  storefront: "CA",
  title: "Catalogue name",
  feedUrl: "https://feeds.example.test/trail.xml",
};
const detail = parseApplePodcastRss(feedXml, show);
assert.equal(detail.title, "Trail Stories RSS");
assert.equal(detail.authorName, "Trail Team");
assert.equal(detail.description, "Public trail episodes.");
assert.equal(detail.artworkUrl, "https://cdn.example.test/show.jpg");
assert.equal(detail.episodes.length, APPLE_PODCAST_PAGE_SIZE + 1);
assert.equal(detail.totalEpisodeCount, APPLE_PODCAST_PAGE_SIZE + 1);
assert.equal(detail.hasMoreEpisodes, false);
assert.equal(detail.episodes[0].id, "episode-1");
assert.equal(detail.episodes[0].durationSeconds, 3723);
assert.equal(detail.episodes[0].description, "A great run.");
assert.equal(detail.episodes[0].seasonNumber, 2);
assert.equal(detail.episodes[0].episodeNumber, 7);
assert.equal(detail.episodes.at(-1)?.id, "episode-51");
assert.throws(
  () => parseApplePodcastRss("<rss><channel><item></channel></rss>", show),
  /valid XML/,
);

const originalFetch = globalThis.fetch;
const requestedUrls = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  requestedUrls.push(url);
  if (url.pathname === "/search") {
    return Response.json({
      resultCount: 1,
      results: [
        {
          collectionId: 12345,
          collectionName: "Trail Stories",
          artistName: "Trail Team",
          collectionViewUrl:
            "https://podcasts.apple.com/ca/podcast/trail-stories/id12345",
          feedUrl: "https://feeds.example.test/trail.xml",
          artworkUrl600: "https://cdn.example.test/catalogue.jpg",
          primaryGenreName: "Sports",
          trackCount: 120,
        },
      ],
    });
  }
  if (url.pathname === "/lookup") {
    return Response.json({
      resultCount: 1,
      results: [
        {
          collectionId: 12345,
          collectionName: "Trail Stories",
          artistName: "Trail Team",
          collectionViewUrl:
            "https://podcasts.apple.com/ca/podcast/trail-stories/id12345",
          feedUrl: "https://feeds.example.test/trail.xml",
        },
      ],
    });
  }
  if (url.hostname === "feeds.example.test") {
    return new Response(feedXml, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    });
  }
  return new Response("not found", { status: 404 });
};

try {
  const searchResults = await searchApplePodcasts("trail running");
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].title, "Trail Stories");
  assert.equal(searchResults[0].episodeCount, 120);

  const loaded = await loadApplePodcast(
    "https://podcasts.apple.com/ca/podcast/trail-stories/id12345",
  );
  assert.equal(loaded.episodes.length, APPLE_PODCAST_PAGE_SIZE);
  assert.equal(loaded.totalEpisodeCount, APPLE_PODCAST_PAGE_SIZE + 1);
  assert.equal(loaded.hasMoreEpisodes, true);

  const olderEpisodes = await loadApplePodcast(
    "https://podcasts.apple.com/ca/podcast/trail-stories/id12345",
    APPLE_PODCAST_PAGE_SIZE,
  );
  assert.equal(olderEpisodes.episodes.length, 1);
  assert.equal(olderEpisodes.episodes[0].id, "episode-51");
  assert.equal(olderEpisodes.hasMoreEpisodes, false);
  assert.equal(
    requestedUrls.filter((url) => url.hostname === "feeds.example.test").length,
    1,
  );
  assert.equal(
    requestedUrls.filter((url) => url.pathname === "/lookup").length,
    1,
  );
  assert.equal(
    requestedUrls.find((url) => url.pathname === "/lookup")?.searchParams.get("country"),
    "CA",
  );
  assert.equal(
    requestedUrls.find((url) => url.pathname === "/search")?.searchParams.get("media"),
    "podcast",
  );
} finally {
  globalThis.fetch = originalFetch;
}

const queuedAudio = createQueuedJob(
  {
    source: "audio",
    audioUrl: "https://cdn.example.test/episode-1.mp3",
    title: "Trail Stories - First & Fast",
    fileBaseName: "Trail Stories - First & Fast",
  },
  "2026-07-10T00:00:00.000Z",
);
assert.equal(queuedAudio?.entryType, "audio");
assert.equal(queuedAudio?.url, "https://cdn.example.test/episode-1.mp3");
assert.equal(queuedAudio?.fileBaseName, "Trail Stories - First & Fast");
assert.equal(
  createQueuedJob(
    {
      source: "audio",
      audioUrl: "file:///private/episode.mp3",
      title: "Blocked",
    },
    "2026-07-10T00:00:00.000Z",
  ),
  null,
);
assert.equal(
  computeOverallProgress({ entryType: "audio", trackProgress: 75, previousProgress: 50 }),
  75,
);

console.log("apple podcasts tests passed");
