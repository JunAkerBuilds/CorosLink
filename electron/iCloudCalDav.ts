import { XMLParser, XMLValidator } from "fast-xml-parser";
import type {
  AppleCalendarCredentials,
  CalendarChoice,
} from "./calendarSyncTypes";

const ROOT = "https://caldav.icloud.com/";
const XML_NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
});
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
const array = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export class ICloudCalendarError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Never forward a calendar password to a URL outside Apple's CalDAV hosts. */
export function iCloudCalendarUrl(value: string, base = ROOT): URL {
  const url = new URL(value, base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    url.search ||
    !/^(?:p\d+-)?caldav\.icloud\.com$/.test(url.hostname)
  ) {
    throw new Error(
      "iCloud returned an unexpected calendar address. Connection stopped.",
    );
  }
  return url;
}

export function calendarResourceUrl(value: string, calendarId: string): URL {
  const calendar = iCloudCalendarUrl(calendarId);
  const url = iCloudCalendarUrl(value, calendar.href);
  const prefix = calendar.pathname.endsWith("/")
    ? calendar.pathname
    : `${calendar.pathname}/`;
  const child = url.pathname.slice(prefix.length);
  if (
    url.origin !== calendar.origin ||
    !url.pathname.startsWith(prefix) ||
    !child ||
    /[\/\\]/.test(decodeURIComponent(child))
  ) {
    throw new Error(
      "iCloud returned an event outside the selected calendar. Sync stopped.",
    );
  }
  return url;
}

export function parseDavResponses(
  xml: string,
): Array<{ href: string; props: RecordValue; failed: boolean }> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error("iCloud returned an invalid calendar response.");
  const parsed = record(parser.parse(xml));
  if (!("multistatus" in parsed) || "error" in record(parsed.multistatus))
    throw new Error("iCloud did not return a complete calendar response.");
  return array(record(parsed.multistatus).response).map((value) => {
    const response = record(value);
    const href = text(response.href).trim();
    if (!href) throw new Error("iCloud returned an event without an address.");
    const props: RecordValue = {};
    for (const value of array(response.propstat)) {
      const propstat = record(value);
      if (/^HTTP\/\S+ 2\d\d\b/.test(text(propstat.status).trim()))
        Object.assign(props, record(propstat.prop));
    }
    return {
      href,
      props,
      failed: Boolean(
        response.status &&
        !/^HTTP\/\S+ 2\d\d\b/.test(text(response.status).trim()),
      ),
    };
  });
}

export interface ICloudCalendarEvent {
  href: string;
  etag: string;
  data: string;
}

export class ICloudCalDav {
  constructor(
    private readonly credentials: AppleCalendarCredentials,
    private readonly signal: AbortSignal,
    private readonly assertAccount: () => void = () => {},
  ) {}

  private async request(
    urlInput: string,
    method: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<{ response: Response; url: string }> {
    let url = iCloudCalendarUrl(urlInput);
    for (let redirects = 0; redirects <= 5; redirects++) {
      this.signal.throwIfAborted();
      this.assertAccount();
      const response = await fetch(url.href, {
        method,
        redirect: "manual",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.credentials.email}:${this.credentials.appPassword}`).toString("base64")}`,
          "Content-Type": "application/xml; charset=utf-8",
          ...headers,
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]),
      });
      this.signal.throwIfAborted();
      this.assertAccount();
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        // Discovery is redirected between iCloud shards. Writes must stay on
        // their discovered collection, even if a server sends a redirect.
        if (!location || !["PROPFIND", "REPORT"].includes(method))
          throw new Error(
            "iCloud redirected an event operation. Reconnect your calendar.",
          );
        url = iCloudCalendarUrl(location, url.href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ICloudCalendarError(
          response.status,
          response.status === 401
            ? "Apple Calendar sign-in expired or was rejected. Connect again with an app-specific password."
            : response.status === 403
              ? "iCloud denied calendar access. Choose a calendar you can edit."
              : response.status === 412
                ? "An iCloud event changed during sync. Sync again to use its latest version."
                : response.status === 429
                  ? "iCloud is temporarily rate limited. Try syncing again later."
                  : response.status === 404
                    ? "The iCloud calendar or event is no longer available. Choose a calendar again."
                    : `iCloud calendar request failed (${response.status}). Try again.`,
        );
      }
      return { response, url: url.href };
    }
    throw new Error("iCloud redirected too many times. Try connecting again.");
  }

  private async readBody(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        this.signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > 16 * 1024 * 1024)
          throw new Error(
            "The iCloud calendar response is too large. Choose a dedicated workout calendar.",
          );
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private async propfind(url: string, properties: string, depth = "0") {
    const result = await this.request(
      url,
      "PROPFIND",
      `<?xml version="1.0" encoding="utf-8"?><d:propfind ${XML_NS}><d:prop>${properties}</d:prop></d:propfind>`,
      { Depth: depth },
    );
    return {
      rows: parseDavResponses(await this.readBody(result.response)),
      url: result.url,
    };
  }

  async discover(): Promise<{ homeUrl: string; calendars: CalendarChoice[] }> {
    const root = await this.propfind(ROOT, "<d:current-user-principal/>");
    const principalHref = root.rows
      .map((row) => text(record(row.props["current-user-principal"]).href))
      .find(Boolean);
    if (!principalHref)
      throw new Error(
        "Could not find your iCloud account. Enable iCloud Calendar, then reconnect.",
      );
    const principal = iCloudCalendarUrl(principalHref, root.url).href;
    const result = await this.propfind(principal, "<c:calendar-home-set/>");
    const homeHref = result.rows
      .map((row) => text(record(row.props["calendar-home-set"]).href))
      .find(Boolean);
    if (!homeHref)
      throw new Error(
        "No iCloud calendar account was found. Enable Calendar in iCloud settings.",
      );
    const homeUrl = iCloudCalendarUrl(homeHref, result.url).href;
    return { homeUrl, calendars: await this.listCalendars(homeUrl) };
  }

  async listCalendars(homeUrl: string): Promise<CalendarChoice[]> {
    const result = await this.propfind(
      homeUrl,
      "<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/>",
      "1",
    );
    const calendars: CalendarChoice[] = [];
    for (const row of result.rows) {
      if (row.failed || !("calendar" in record(row.props.resourcetype)))
        continue;
      const components = array(
        record(row.props["supported-calendar-component-set"]).comp,
      );
      if (
        !components.some(
          (component) => record(component)["@_name"] === "VEVENT",
        )
      )
        continue;
      const privileges = new Set(
        array(
          record(row.props["current-user-privilege-set"]).privilege,
        ).flatMap((value) => Object.keys(record(value))),
      );
      if (
        !privileges.has("all") &&
        !privileges.has("write") &&
        !["write-content", "bind", "unbind"].every((name) =>
          privileges.has(name),
        )
      )
        continue;
      const id = iCloudCalendarUrl(row.href, result.url).href;
      calendars.push({
        id: id.endsWith("/") ? id : `${id}/`,
        name: text(row.props.displayname).trim() || "iCloud calendar",
        primary: false,
      });
    }
    return calendars.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listEvents(
    calendarId: string,
    source: string,
  ): Promise<ICloudCalendarEvent[]> {
    if (!/^[a-f0-9]{64}$/.test(source))
      throw new Error("Invalid calendar account identity.");
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${XML_NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:prop-filter name="UID"><c:text-match collation="i;octet">coroslink-${source}-</c:text-match></c:prop-filter></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const result = await this.request(calendarId, "REPORT", body, {
      Depth: "1",
    });
    return parseDavResponses(await this.readBody(result.response)).map(
      (row) => {
        const etag = text(row.props.getetag).trim();
        const data = text(row.props["calendar-data"]);
        if (row.failed || !etag || !data)
          throw new Error(
            "iCloud returned an incomplete event list. Sync stopped before making changes.",
          );
        return {
          href: calendarResourceUrl(row.href, calendarId).href,
          etag,
          data,
        };
      },
    );
  }

  async getEvent(
    calendarId: string,
    href: string,
  ): Promise<ICloudCalendarEvent> {
    const url = calendarResourceUrl(href, calendarId).href;
    const result = await this.request(url, "GET");
    const etag = result.response.headers.get("etag");
    if (!etag)
      throw new Error("iCloud omitted the event version. Sync stopped.");
    return { href: url, etag, data: await this.readBody(result.response) };
  }

  async putEvent(
    calendarId: string,
    href: string,
    data: string,
    etag?: string,
  ): Promise<void> {
    const url = calendarResourceUrl(href, calendarId).href;
    const result = await this.request(url, "PUT", data, {
      "Content-Type": "text/calendar; charset=utf-8",
      ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
    });
    await result.response.body?.cancel();
  }

  async deleteEvent(
    calendarId: string,
    event: ICloudCalendarEvent,
  ): Promise<void> {
    if (!event.etag)
      throw new Error("iCloud omitted the event version. Sync stopped.");
    const result = await this.request(
      calendarResourceUrl(event.href, calendarId).href,
      "DELETE",
      undefined,
      { "If-Match": event.etag },
    );
    await result.response.body?.cancel();
  }
}
