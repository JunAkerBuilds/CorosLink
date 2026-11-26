// Reads a playlist through Spotify's internal client endpoints (spclient), the ones Spotify's own apps and librespot
// use. Only the "unlocked" sign-in (Spotify's desktop client identity, spotify.ts) is used here, and only for
// playlists the person's own app is refused: that identity is rate-limited on the public Web API.
const SPCLIENT = "https://spclient.wg.spotify.com";
import { t } from "@/lib/i18n";
/** Rows per playlist page. */
export const PAGE_LENGTH = 500;
/** Track details fetched at once. */
export const METADATA_AT_ONCE = 8;
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_ROWS = 5000;

export interface InternalTrack { id: string; artist: string; title: string; album: string | null; secs: number | null; artwork: string | null }

export class SpotifyInternalError extends Error {
  constructor(readonly status: number, what: string) { super(`Spotify refused the ${what} request (${status}).`); }
}

/** A 22-character track id as the 32-hex-digit gid the metadata endpoint wants. */
export function base62ToHex(id: string): string {
  let value = 0n;
  for (const c of id) {
    const digit = BASE62.indexOf(c);
    if (digit < 0) throw new Error(t("Not a Spotify id."));
    value = value * 62n + BigInt(digit);
  }
  return value.toString(16).padStart(32, "0");
}

/** A minimal protobuf reader: [field number, varint | bytes] pairs; fixed-width fields are skipped. */
export function* protoFields(buffer: Uint8Array): Generator<[number, bigint | Uint8Array]> {
  let at = 0;
  const varint = (): bigint => {
    let result = 0n, shift = 0n;
    for (;;) {
      if (at >= buffer.length) throw new Error(t("Truncated Spotify playlist response."));
      const byte = buffer[at++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
    }
  };
  while (at < buffer.length) {
    const key = Number(varint());
    const field = key >>> 3;
    switch (key & 7) {
      case 0: yield [field, varint()]; break;
      case 1: at += 8; break;
      case 2: { const length = Number(varint()); yield [field, buffer.subarray(at, at + length)]; at += length; break; }
      case 5: at += 4; break;
      default: throw new Error(t("Unreadable Spotify playlist response."));
    }
  }
}

/**
 * One page of a playlist (SelectedListContent): field 2 is the length, 5 the contents, whose field-3 items carry the
 * track URI in field 1. Episodes and local files have no track to search for, so they're left out.
 */
export function readPage(page: Uint8Array): { total: number | null; items: number; ids: string[] } {
  let total: number | null = null, items = 0;
  const ids: string[] = [];
  for (const [field, value] of protoFields(page)) {
    if (field === 2 && typeof value === "bigint") total = Number(value);
    else if (field === 5 && value instanceof Uint8Array) {
      for (const [f, item] of protoFields(value)) {
        if (f !== 3 || !(item instanceof Uint8Array)) continue;
        items++;
        for (const [g, uri] of protoFields(item)) {
          if (g !== 1 || !(uri instanceof Uint8Array)) continue;
          const m = /^spotify:track:([0-9A-Za-z]{22})$/.exec(Buffer.from(uri).toString("utf8"));
          if (m) ids.push(m[1]);
        }
      }
    }
  }
  return { total, items, ids };
}

interface Metadata { name?: string; duration?: number; artist?: { name?: string }[]; album?: { name?: string; cover_group?: { image?: { file_id?: string; size?: string }[] } } }

/** The album's small cover on Spotify's image host. */
function coverOf(m: Metadata): string | null {
  const images = m.album?.cover_group?.image ?? [];
  const id = (images.find((i) => i.size === "SMALL") ?? images[0])?.file_id;
  return id && /^[0-9a-f]{40}$/i.test(id) ? `https://i.scdn.co/image/${id}` : null;
}

export async function readPlaylist(get: typeof fetch, token: string, playlistId: string): Promise<InternalTrack[]> {
  const auth = { Authorization: `Bearer ${token}` };
  const ids: string[] = [];
  for (let from = 0, total = Infinity; from < total && ids.length < MAX_ROWS; from += PAGE_LENGTH) {
    const answer = await get(`${SPCLIENT}/playlist/v2/playlist/${encodeURIComponent(playlistId)}?from=${from}&length=${PAGE_LENGTH}`, { headers: auth });
    if (!answer.ok) throw new SpotifyInternalError(answer.status, "playlist");
    const page = readPage(new Uint8Array(await answer.arrayBuffer()));
    if (page.total != null) total = page.total;
    ids.push(...page.ids);
    if (!page.items) break;
  }
  const tracks: (InternalTrack | undefined)[] = new Array(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      const answer = await get(`${SPCLIENT}/metadata/4/track/${base62ToHex(ids[i])}?market=from_token`, { headers: { ...auth, Accept: "application/json" } });
      if (answer.status === 404) continue;
      if (!answer.ok) throw new SpotifyInternalError(answer.status, "track details");
      const m = (await answer.json()) as Metadata;
      if (!m.name) continue;
      tracks[i] = {
        id: ids[i], title: m.name, artist: (m.artist ?? []).map((a) => a.name).filter(Boolean).join(", "),
        album: m.album?.name ?? null, secs: m.duration ? Math.round(m.duration / 1000) : null, artwork: coverOf(m),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(METADATA_AT_ONCE, ids.length) }, worker));
  return tracks.filter((t): t is InternalTrack => !!t);
}
