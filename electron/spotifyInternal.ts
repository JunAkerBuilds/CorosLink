// Reads a playlist through Spotify's internal client endpoints (spclient), the
// ones the official apps and librespot use. Only the followed-playlists grant
// (Spotify's desktop client identity) is accepted here; that identity is
// heavily rate-limited on the public Web API, so it is never used there.

const SPCLIENT = "https://spclient.wg.spotify.com";
const PAGE_LENGTH = 500;
const METADATA_CONCURRENCY = 8;
const BASE62 =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface InternalPlaylistTrack {
  id: string;
  artistName: string;
  trackName: string;
  albumName?: string;
  durationMs?: number;
  addedAt?: string;
  artworkUrl?: string;
}

interface PlaylistRow {
  trackId: string;
  addedAt?: string;
}

interface TrackMetadata {
  name?: string;
  duration?: number;
  artist?: Array<{ name?: string }>;
  album?: {
    name?: string;
    cover_group?: {
      image?: Array<{ file_id?: string; size?: string }>;
    };
  };
}

export class SpotifyInternalError extends Error {
  constructor(readonly status: number, what: string) {
    super(`Spotify refused the ${what} request (${status}).`);
  }
}

export async function readPlaylistTracks(
  accessToken: string,
  playlistId: string
): Promise<InternalPlaylistTrack[]> {
  const rows = await readPlaylistRows(accessToken, playlistId);
  const tracks: Array<InternalPlaylistTrack | undefined> = new Array(rows.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < rows.length) {
      const index = next++;
      const row = rows[index];
      const metadata = await readTrackMetadata(accessToken, row.trackId);
      if (!metadata?.name) {
        continue;
      }
      tracks[index] = {
        id: row.trackId,
        artistName:
          (metadata.artist ?? [])
            .map((artist) => artist.name)
            .filter(Boolean)
            .join(", ") || "Unknown Artist",
        trackName: metadata.name,
        albumName: metadata.album?.name,
        durationMs: metadata.duration,
        addedAt: row.addedAt,
        artworkUrl: coverUrl(metadata)
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(METADATA_CONCURRENCY, rows.length) }, worker)
  );
  return tracks.filter((track): track is InternalPlaylistTrack => Boolean(track));
}

async function readPlaylistRows(
  accessToken: string,
  playlistId: string
): Promise<PlaylistRow[]> {
  const rows: PlaylistRow[] = [];
  let total = Infinity;

  for (let from = 0; from < total; from += PAGE_LENGTH) {
    const url = `${SPCLIENT}/playlist/v2/playlist/${encodeURIComponent(playlistId)}?from=${from}&length=${PAGE_LENGTH}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new SpotifyInternalError(response.status, "playlist");
    }

    // SelectedListContent: 2 = length, 5 = contents (ListItems: 3 = items,
    // each Item: 1 = uri, 2 = attributes with 2 = added timestamp in ms).
    const page = Buffer.from(await response.arrayBuffer());
    let pageItems = 0;
    for (const [field, value] of protoFields(page)) {
      if (field === 2 && typeof value === "bigint") {
        total = Number(value);
      } else if (field === 5 && value instanceof Uint8Array) {
        for (const [listField, item] of protoFields(value)) {
          if (listField !== 3 || !(item instanceof Uint8Array)) {
            continue;
          }
          pageItems += 1;
          const row = playlistRow(item);
          if (row) {
            rows.push(row);
          }
        }
      }
    }

    if (pageItems === 0) {
      break;
    }
  }

  return rows;
}

function playlistRow(item: Uint8Array): PlaylistRow | undefined {
  let uri = "";
  let addedAt: string | undefined;
  for (const [field, value] of protoFields(item)) {
    if (field === 1 && value instanceof Uint8Array) {
      uri = Buffer.from(value).toString("utf8");
    } else if (field === 2 && value instanceof Uint8Array) {
      for (const [attribute, raw] of protoFields(value)) {
        if (attribute === 2 && typeof raw === "bigint" && raw > 0n) {
          addedAt = new Date(Number(raw)).toISOString();
        }
      }
    }
  }

  // Episodes and local files have no track metadata to search with.
  const match = /^spotify:track:([0-9A-Za-z]{22})$/.exec(uri);
  return match ? { trackId: match[1], addedAt } : undefined;
}

async function readTrackMetadata(
  accessToken: string,
  trackId: string
): Promise<TrackMetadata | undefined> {
  const url = `${SPCLIENT}/metadata/4/track/${base62ToHex(trackId)}?market=from_token`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new SpotifyInternalError(response.status, "track metadata");
  }
  return (await response.json()) as TrackMetadata;
}

function coverUrl(metadata: TrackMetadata): string | undefined {
  const images = metadata.album?.cover_group?.image ?? [];
  const image =
    images.find((candidate) => candidate.size === "SMALL") ?? images[0];
  return image?.file_id ? `https://i.scdn.co/image/${image.file_id}` : undefined;
}

function base62ToHex(id: string): string {
  let value = 0n;
  for (const character of id) {
    value = value * 62n + BigInt(BASE62.indexOf(character));
  }
  return value.toString(16).padStart(32, "0");
}

// Minimal protobuf reader: yields [field number, varint | bytes] pairs.
function* protoFields(
  buffer: Uint8Array
): Generator<[number, bigint | Uint8Array]> {
  let offset = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (offset >= buffer.length) {
        throw new Error("Truncated Spotify playlist response.");
      }
      const byte = buffer[offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) {
        return result;
      }
      shift += 7n;
    }
  };

  while (offset < buffer.length) {
    const key = Number(varint());
    const field = key >>> 3;
    switch (key & 7) {
      case 0:
        yield [field, varint()];
        break;
      case 1:
        offset += 8;
        break;
      case 2: {
        const length = Number(varint());
        yield [field, buffer.subarray(offset, offset + length)];
        offset += length;
        break;
      }
      case 5:
        offset += 4;
        break;
      default:
        throw new Error("Unreadable Spotify playlist response.");
    }
  }
}
