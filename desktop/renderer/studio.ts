// The Studio pages' calls to the main process (desktop/main/watchface/studio.ts), at /api/desktop/studio.
import type { WatchfaceCarriedPreferences } from "../watchface/engine/watchfaceCarriedPreferences";
import type { CorosWatchfaceDesignState, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../watchface/types";
import type { WatchfaceBuildInput } from "../watchface/archive/build";
import type { CorosFace, ProjectSummary, StoredProject, StudioTemplate } from "../main/watchface/studio";
import type { CommunityFace, CommunityGroup, CommunityPage, CommunityProgress, CommunityQuery } from "../main/watchface/community";
import type { AccountStatus } from "../main/watchface/corosAccount";
import type { CorosCatalog, CorosRegion } from "../main/watchface/corosMobile";
import type { TemplateInfo } from "../watchface/archive/template";
import type { OfficialAsset, OfficialFrames, OfficialPage, OfficialQuery, OfficialStatus } from "../main/watchface/officialAssets";
import type { GoogleFace, GoogleFamily, GoogleFamilyFaces, GoogleFontList } from "../main/watchface/googleFonts";

export type { GoogleFace, GoogleFamily, GoogleFamilyFaces, GoogleFontList, OfficialAsset, OfficialFrames, OfficialPage, OfficialQuery, OfficialStatus };
export type { AccountStatus, CommunityFace, CommunityGroup, CommunityPage, CommunityProgress, CommunityQuery, CorosCatalog, CorosFace, CorosRegion, ProjectSummary, StoredProject, StudioTemplate };

export class StudioProblem extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

const BASE = "/api/desktop/studio";

async function parse<T>(answer: Response): Promise<T> {
  const body = (await answer.json().catch(() => ({}))) as T & { error?: { code: string; message: string } };
  if (!answer.ok || body.error) throw new StudioProblem(body.error?.message ?? "That didn't work.", body.error?.code ?? "problem");
  return body;
}

const get = <T>(route: string) => fetch(`${BASE}${route}`, { cache: "no-store" }).then((a) => parse<T>(a));
const send = (route: string, body: unknown) => fetch(`${BASE}${route}`, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Clink-Hub": "1" }, body: JSON.stringify(body),
});
const post = <T>(route: string, body: object = {}) => send(route, body).then((a) => parse<T>(a));
const project = (id: string) => `/projects/${encodeURIComponent(id)}`;

export const listTemplates = (watch: string) => get<{ savedAt: string; templates: StudioTemplate[] }>(`/templates?watch=${encodeURIComponent(watch)}`);
export const templatePicture = (watch: string, id: string) => `${BASE}/templates/${encodeURIComponent(id)}/picture?watch=${encodeURIComponent(watch)}`;

let lastProjects: ProjectSummary[] | null = null;
/** The list as Studio last got it, so coming back shows it at once while listProjects refreshes it. */
export const knownProjects = () => lastProjects;
export const listProjects = () => get<{ projects: ProjectSummary[] }>("/projects").then((b) => (lastProjects = b.projects));
export const openProject = (id: string) => get<{ project: StoredProject; template: TemplateInfo }>(project(id));
export const projectPicture = (p: ProjectSummary) => `${BASE}${project(p.projectId)}/preview?at=${encodeURIComponent(p.previewUpdatedAt ?? p.updatedAt)}`;
export const createProject = (body: { watch: string; templateId: string; blank?: boolean; name?: string; design: CorosWatchfaceDesignState }) =>
  post<{ project: ProjectSummary }>("/projects", body).then((b) => b.project);
export const saveProject = (id: string, body: { name: string; design: CorosWatchfaceDesignState; previewDataUrl?: string }) =>
  post<{ project: ProjectSummary }>(project(id), body).then((b) => b.project);
export const duplicateProject = (id: string) => post<{ project: ProjectSummary }>(`${project(id)}/duplicate`).then((b) => b.project);
export const deleteProject = (id: string) => post<{ deleted: true }>(`${project(id)}/delete`);
export async function importProjectFile(file: File, watch: string): Promise<ProjectSummary> {
  const answer = await fetch(`${BASE}/projects/import?name=${encodeURIComponent(file.name)}&watch=${encodeURIComponent(watch)}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Clink-Hub": "1" }, body: file,
  });
  return (await parse<{ project: ProjectSummary }>(answer)).project;
}

export const templateDetails = (id: string) => get<{ details: CorosWatchfaceTemplateDetails }>(`${project(id)}/template`).then((b) => b.details);
export const templateConfigTexts = (id: string) => get<{ files: { path: string; text: string }[] }>(`${project(id)}/config-texts`).then((b) => b.files);
export const templateAssets = (id: string, paths: string[], skipMissing = false) =>
  post<{ assets: CorosWatchfaceTemplateAsset[] }>(`${project(id)}/assets`, { paths, skipMissing }).then((b) => b.assets);

/** Asks for a file the main process makes and offers to save it (the save dialog is the app's own). */
async function download(route: string, body: unknown, fallbackName: string): Promise<{ name: string; warnings: string[] }> {
  const answer = await send(route, body);
  if (!answer.ok) await parse(answer);
  const header = answer.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const name = (utf8 ? decodeURIComponent(utf8) : /filename="([^"]+)"/.exec(header)?.[1]) || fallbackName;
  const url = URL.createObjectURL(await answer.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  const warnings = answer.headers.get("x-clink-warnings");
  return { name, warnings: warnings ? (JSON.parse(decodeURIComponent(warnings)) as string[]) : [] };
}

/** CorosLink's portable project ZIP: opens in Studio here and in CorosLink. */
export const downloadEditable = (id: string, body: { name: string; design: CorosWatchfaceDesignState; previewDataUrl?: string }) =>
  download(`${project(id)}/export/project`, body, "watch face (editable).zip");
/** The final archive the watch and the COROS app take. */
export const downloadFinal = (id: string, input: WatchfaceBuildInput) => download(`${project(id)}/export/final`, input, "watch face.zip");
/** The compiled BIN, checked before it's offered. */
export const downloadBin = (id: string, input: WatchfaceBuildInput) => download(`${project(id)}/export/bin`, input, "watch face.bin");

// ───── Send (desktop/main/watchface/send.ts) ─────

/** A face built once for sending; everything in the Send dialog works from it for 15 minutes. */
export interface PreparedFace { id: string; name: string; watch: string; bytes: number; details: CorosWatchfaceTemplateDetails }
const prepared = (id: string) => `/prepared/${encodeURIComponent(id)}`;
/** `watch`: another watch, only for a face built from its own layout (see nativeLayout). */
export const prepareSend = (id: string, input: WatchfaceBuildInput, watch?: string) =>
  post<{ prepared: PreparedFace }>(`${project(id)}/send/prepare`, watch ? { ...input, watch } : input).then((b) => b.prepared);
export const preparedAssets = (id: string, paths: string[]) => post<{ assets: CorosWatchfaceTemplateAsset[] }>(`${prepared(id)}/assets`, { paths }).then((b) => b.assets);
export const downloadPreparedBin = (id: string, body: { name: string; fullColor: boolean; smoothEdges: boolean }) => download(`${prepared(id)}/bin`, body, "watch face.bin");
export const downloadPreparedFinal = (id: string, name: string) => download(`${prepared(id)}/final`, { name }, "watch face.zip");
/** Saves into a folder picked with pickFolder: the final ZIP, or the files unpacked (Development export). */
export const savePreparedTo = (id: string, body: { folderId: string; name: string; unpacked?: boolean }) => post<{ saved: string }>(`${prepared(id)}/folder`, body).then((b) => b.saved);
export const pickFolder = () => post<{ folder: { id: string; label: string } | null }>("/folders/pick").then((b) => b.folder);
/** Send to iPhone: C-LINK on the phone fetches the face over this network (phoneSend.ts). */
export interface PhoneSend { link: string; qrDataUrl: string; name: string; size: number; hosts: string[]; expiresAt: number }
export interface PhoneSendStatus { active: boolean; sending: boolean; received: number; expiresAt?: number }
/** The watch paired in Local mode: its face slots, and installing a prepared face on it over Bluetooth. */
export interface FaceSlots { slots: { slot: number; faceId?: number }[]; shown: number | null; installed?: number }
export const watchSlots = () => get<FaceSlots>("/watch/slots");
export const installPrepared = (id: string, body: { name: string; fullColor: boolean; smoothEdges: boolean; slot?: number; expectedFaceId?: number | null; replace?: boolean }) =>
  post<FaceSlots & { warnings: string[] }>(`${prepared(id)}/install`, body);
export const sendToPhone = (id: string, name: string) => post<{ send: PhoneSend }>(`${prepared(id)}/phone`, { name }).then((b) => b.send);
export const phoneStatus = () => get<{ status: PhoneSendStatus }>("/phone").then((b) => b.status);
export const stopPhone = () => post<{ status: PhoneSendStatus }>("/phone/stop").then((b) => b.status);
/** The COROS app: the face goes up to the signed-in account and comes back as a share link (corosShare.ts). */
export interface CorosShareLink { url: string; qrDataUrl: string; expiresAt: string }
export const shareToCoros = (id: string, body: { name: string; backgroundImageId: number }) => post<{ link: CorosShareLink }>(`${prepared(id)}/coros`, body).then((b) => b.link);
/** What a conversion did (desktop/main/watchface/studio.ts). */
export interface ConversionResult { rebuilt: boolean; generatedAod: boolean; noCorosTemplate: boolean }
/**
 * A new project for another watch, converted from this one's 800 px master; `scratch` ones are for All watches. A face
 * built from its own layout sends its composition (`build`) and is rebuilt for the watch with the edits applied.
 */
export const convertProject = (id: string, body: { watch: string; design: CorosWatchfaceDesignState; name?: string; scratch?: boolean; build?: WatchfaceBuildInput; carried?: WatchfaceCarriedPreferences }) =>
  post<{ project: ProjectSummary; result: ConversionResult }>(`${project(id)}/convert`, body);
export const watchConnection = () => get<{ watch: { connected: boolean; reason?: string } }>("/watch").then((b) => b.watch);

// ───── Community ─────

const query = (values: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(values).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "").map(([k, v]) => [k, String(v)])).toString();

export const listCommunity = (q: CommunityQuery) => get<CommunityPage>(`/community?${query({ ...q })}`);
export const communityFace = (slug: string, model?: string) => get<{ face: CommunityFace }>(`/community/${encodeURIComponent(slug)}?${query({ model })}`).then((b) => b.face);
export const communityPicture = (face: CommunityFace) => `${BASE}/community/previews/${face.id}`;
/** The face's animated WebP (404 when it has none). */
export const communityAnimation = (face: CommunityFace) => `${BASE}/community/animations/${face.id}`;
export const communityProgress = () => get<{ progress: CommunityProgress | null }>("/community/progress").then((b) => b.progress);
export const openCommunity = (slug: string, model: string | undefined, watch: string) =>
  post<{ project: ProjectSummary; title: string }>(`/community/${encodeURIComponent(slug)}/open`, { model, watch }).then((b) => b.project);

// ───── COROS account ─────

export const corosAccount = () => get<{ account: AccountStatus | null }>("/coros").then((b) => b.account);
export const corosSignIn = (body: { email: string; password: string; region: CorosRegion; remember: boolean }) => post<{ account: AccountStatus }>("/coros/sign-in", body).then((b) => b.account);
export const corosSignInSaved = (region: CorosRegion) => post<{ account: AccountStatus }>("/coros/sign-in/saved", { region }).then((b) => b.account);
export const corosSignOut = () => post<{ account: AccountStatus }>("/coros/sign-out").then((b) => b.account);
export const corosForget = () => post<{ account: AccountStatus }>("/coros/forget").then((b) => b.account);

/** The advanced filters for COROS's lists; empty means the watch's own. */
export interface CorosFilters { firmwareType?: string; language?: string; maxVersion?: string; sn?: string; modelVersion?: string }
export const listCorosFaces = (catalog: CorosCatalog, watch: string, f: CorosFilters = {}) =>
  get<{ faces: CorosFace[] }>(`/coros/faces?${query({ catalog, watch, ...f })}`).then((b) => b.faces);
export const corosPicture = (catalog: CorosCatalog, id: string) => `${BASE}/coros/faces/${id}/picture?catalog=${catalog}`;
export const openCorosFace = (catalog: CorosCatalog, id: string, watch: string, name?: string) =>
  post<{ project: ProjectSummary }>(`/coros/faces/${id}/open`, { catalog, watch, name }).then((b) => b.project);

export const said = (e: unknown): string => (e instanceof Error ? e.message : "That didn't work.");

/** "12 minutes ago", "Yesterday", "3 Nov". */
export function edited(at: number | string, now = Date.now()): string {
  const time = typeof at === "string" ? Date.parse(at) : at;
  const mins = Math.round((now - time) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The watch Studio makes new faces for, remembered on this computer. */
export function chosenWatch(): string {
  try { return localStorage.getItem("studio.watch") ?? "pace-pro"; } catch { return "pace-pro"; }
}
export function chooseWatch(model: string): void {
  try { localStorage.setItem("studio.watch", model); } catch { /* fine without */ }
}

/** Whether this computer has pressed the watch's Back button in Studio yet; until then it asks to be pressed. */
export function backButtonTried(): boolean {
  try { return localStorage.getItem("studio.backTried") === "1"; } catch { return true; }
}
export function markBackButtonTried(): void {
  try { localStorage.setItem("studio.backTried", "1"); } catch { /* fine without */ }
}

// ───── Official COROS artwork (desktop/main/watchface/officialAssets.ts) ─────

/** The library for a watch; the first ask starts its download, and the page asks again while it loads. */
export const officialStatus = (watch: string) => get<{ status: OfficialStatus }>(`/official?${query({ watch })}`).then((b) => b.status);
export const refreshOfficial = (watch: string) => post<{ status: OfficialStatus }>("/official/refresh", { watch }).then((b) => b.status);
export const listOfficial = (watch: string, q: OfficialQuery) => get<OfficialPage>(`/official/assets?${query({ watch, ...q })}`);
export const officialStrip = (watch: string, id: string) => `${BASE}/official/strips/${id}?${query({ watch })}`;
export const officialSet = (watch: string, id: string) => get<{ set: OfficialFrames }>(`/official/sets/${id}?${query({ watch })}`).then((b) => b.set);

// ───── Google Fonts (desktop/main/watchface/googleFonts.ts) ─────

export const googleFontList = () => get<GoogleFontList>("/fonts/google");
export const googleFamily = (name: string, preview = false) => get<{ family: GoogleFamilyFaces }>(`/fonts/google/family?${query({ name, preview: preview ? 1 : undefined })}`).then((b) => b.family);
export const googleFontFile = (file: string) => `${BASE}/fonts/google/files/${file}`;
/** The Google families among these names, fetched or from this computer's cache, and the ones that couldn't be. */
export const resolveGoogleFonts = (families: string[]) => post<{ loaded: GoogleFamilyFaces[]; failed: { family: string; message: string }[] }>("/fonts/google/resolve", { families });
