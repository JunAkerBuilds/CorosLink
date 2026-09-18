import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  deleteCorosWatchfaceProject,
  downloadCorosWatchfaceTheme,
  duplicateCorosWatchfaceProject,
  exportCorosWatchfaceArchive,
  exportCorosWatchfaceProject,
  listCorosWatchfaceProjects,
  listCorosWatchfaceThemes,
  loadCorosWatchfaceProject,
  publishCorosWatchface,
  selectCorosWatchfaceArchive
} from "./corosWatchfaceService";
import { listLocalFontFamilies } from "./fontService";
import type {
  CorosWatchfaceArchive,
  CorosWatchfaceProjectExportInput,
  CorosWatchfacePublishInput,
  CorosWatchfaceThemeDownloadInput,
  CorosWatchfaceThemeListInput
} from "./types";

type RendererDispatch = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Routes privileged host operations without exposing file or service internals to the renderer. */
export class WatchfaceAutomationService {
  private readonly archives = new Map<string, CorosWatchfaceArchive>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private queued = 0;

  constructor(private readonly rendererDispatch: RendererDispatch) {}

  dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.queued >= 32) return Promise.reject(new Error("Too many watch-face automation operations are waiting."));
    const generation = this.generation;
    this.queued += 1;
    const work = this.queue.catch(() => undefined).then(() => {
      if (generation !== this.generation) throw new Error("Watch-face automation was disabled before this operation started.");
      return this.dispatchNow(method, params);
    });
    this.queue = work.then(
      () => { this.queued -= 1; },
      () => { this.queued -= 1; }
    );
    return work;
  }

  /** Invalidates operations that have not started. Active service calls settle normally. */
  cancel(): void {
    this.generation += 1;
  }

  private async dispatchNow(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "get_schema":
      case "get_context":
      case "apply_commands":
      case "select":
      case "undo":
      case "redo":
      case "set_view":
      case "render_preview":
      case "validate":
      case "save":
      case "close":
        return this.rendererDispatch(method, params);

      case "get_document": {
        const document = await this.rendererDispatch(method, params);
        const archive = document && typeof document === "object"
          ? asArchive((document as Record<string, unknown>).archive)
          : undefined;
        if (archive) this.remember(archive);
        return document;
      }

      case "list_projects":
        return listCorosWatchfaceProjects();

      case "list_fonts":
        return listLocalFontFamilies();

      case "duplicate_project": {
        const project = await duplicateCorosWatchfaceProject(requiredString(params.projectId, "projectId"));
        this.remember(project.archive);
        return project;
      }

      case "delete_project": {
        if (params.confirmed !== true) throw new Error("Deleting a project requires confirmed=true.");
        const projectId = requiredString(params.projectId, "projectId");
        const context = await this.rendererDispatch("get_context", {});
        const activeProjectId = context && typeof context === "object"
          ? optionalString((context as Record<string, unknown>).project &&
              typeof (context as Record<string, unknown>).project === "object"
            ? ((context as Record<string, unknown>).project as Record<string, unknown>).projectId
            : undefined)
          : undefined;
        if (activeProjectId === projectId) {
          throw automationServiceError(
            "ACTIVE_PROJECT",
            "That project is open in Watch Face Studio. Close the editor before deleting it."
          );
        }
        await deleteCorosWatchfaceProject(projectId);
        return { deleted: true, projectId };
      }

      case "import_archive": {
        const archivePath = await requireImportPath(params.path, [".zip", ".dat"], 100 * 1024 * 1024);
        const archive = await selectCorosWatchfaceArchive(archivePath);
        this.remember(archive);
        return archive;
      }

      case "list_templates": {
        const firmwareType = requiredString(params.firmwareType, "firmwareType");
        const input: CorosWatchfaceThemeListInput = {
          firmwareType,
          catalog: "editable",
          ...(typeof params.language === "string" ? { language: params.language } : {})
        };
        const themes = await listCorosWatchfaceThemes(input);
        const query = optionalString(params.query)?.toLocaleLowerCase();
        return query
          ? themes.filter((theme) =>
              [theme.name, theme.category, theme.firmwareType]
                .some((value) => value?.toLocaleLowerCase().includes(query))
            )
          : themes;
      }

      case "load_template": {
        const input: CorosWatchfaceThemeDownloadInput = {
          packageUrl: requiredString(params.packageUrl, "packageUrl"),
          ...(typeof params.name === "string" ? { name: params.name } : {}),
          ...(typeof params.firmwareType === "string" ? { firmwareType: params.firmwareType } : {})
        };
        // The watchface service only accepts package URLs returned by list_templates
        // during this process, preventing this tool from becoming an arbitrary fetcher.
        const downloaded = await downloadCorosWatchfaceTheme(input);
        if (downloaded.archive) this.remember(downloaded.archive);
        return downloaded;
      }

      case "open": {
        const projectId = optionalString(params.project);
        const archiveId = optionalString(params.archive);
        const project = projectId ? await loadCorosWatchfaceProject(projectId) : undefined;
        if (project) this.remember(project.archive);
        const archive = project?.archive ?? (archiveId ? this.requireArchive(archiveId) : undefined);
        if (!archive) throw new Error("Open requires a saved project id or an imported archive id.");
        return this.rendererDispatch("open", {
          ...params,
          ...(project ? { project } : {}),
          archive
        });
      }

      case "convert": {
        const targetArchiveId = optionalString(params.targetArchive);
        return this.rendererDispatch("convert", {
          ...params,
          ...(targetArchiveId ? { targetArchive: this.requireArchive(targetArchiveId) } : {})
        });
      }

      case "export_project": {
        const destinationPath = await requireExportPath(params.destinationPath, [".zip"]);
        const project = await this.rendererDispatch("export_project", params) as CorosWatchfaceProjectExportInput;
        await writeExclusive(destinationPath, (temporaryPath) =>
          exportCorosWatchfaceProject(project, temporaryPath)
        );
        return { saved: true, filePath: destinationPath };
      }

      case "build_archive": {
        const built = await this.rendererDispatch("build_archive", params);
        const archive = asArchive(built);
        if (archive) this.remember(archive);
        return built;
      }

      case "export_archive": {
        const archiveId = requiredString(params.archiveId, "archiveId");
        const destinationPath = await requireExportPath(params.destinationPath, [".zip", ".dat"]);
        this.requireArchive(archiveId);
        await writeExclusive(destinationPath, (temporaryPath) =>
          exportCorosWatchfaceArchive(archiveId, temporaryPath)
        );
        return { saved: true, filePath: destinationPath, archiveId };
      }

      case "publish": {
        if (params.confirmed !== true) throw new Error("Publishing requires confirmed=true after explicit user authorization.");
        const input: CorosWatchfacePublishInput = {
          archiveId: requiredString(params.archiveId, "archiveId"),
          name: requiredString(params.name, "name"),
          firmwareType: requiredString(params.firmwareType, "firmwareType"),
          backgroundImageId: requiredNonNegativeInteger(params.backgroundImageId, "backgroundImageId"),
          ...(typeof params.language === "string" ? { language: params.language } : {})
        };
        this.requireArchive(input.archiveId);
        return publishCorosWatchface(input);
      }

      default:
        throw new Error(`Unknown watch-face automation method "${method}".`);
    }
  }

  private remember(archive: CorosWatchfaceArchive): void {
    this.archives.set(archive.archiveId, archive);
  }

  private requireArchive(archiveId: string): CorosWatchfaceArchive {
    const archive = this.archives.get(archiveId);
    if (!archive) {
      throw new Error("That archive is unavailable. Import, load, build, or open it again first.");
    }
    return archive;
  }
}

function automationServiceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function createWatchfaceAutomationDispatcher(
  rendererDispatch: RendererDispatch
): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  const service = new WatchfaceAutomationService(rendererDispatch);
  return (method, params) => service.dispatch(method, params);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096 || value.includes("\0")) {
    throw new Error(`${name} must be a non-empty bounded string.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

async function requireImportPath(
  value: unknown,
  extensions: string[],
  maximumBytes: number
): Promise<string> {
  const filePath = requiredAbsolutePath(value, extensions);
  const lstat = await fs.promises.lstat(filePath);
  if (lstat.isSymbolicLink() || !lstat.isFile()) throw new Error("Import path must be a regular local file, not a symbolic link.");
  if (lstat.size <= 0 || lstat.size > maximumBytes) throw new Error("The imported file is empty or too large.");
  return fs.promises.realpath(filePath);
}

async function requireExportPath(value: unknown, extensions: string[]): Promise<string> {
  const filePath = requiredAbsolutePath(value, extensions);
  const parent = path.dirname(filePath);
  const parentStat = await fs.promises.stat(parent);
  if (!parentStat.isDirectory()) throw new Error("The export destination directory does not exist.");
  await fs.promises.access(parent, fsConstants.W_OK);
  try {
    await fs.promises.lstat(filePath);
    throw new Error("The export destination already exists. Choose a new path.");
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
  return filePath;
}

function requiredAbsolutePath(value: unknown, extensions: string[]): string {
  const filePath = requiredString(value, "path");
  if (!path.isAbsolute(filePath)) throw new Error("Use an absolute local path.");
  if (!extensions.includes(path.extname(filePath).toLowerCase())) {
    throw new Error(`Path must end in ${extensions.join(" or ")}.`);
  }
  return path.normalize(filePath);
}

async function writeExclusive(
  destinationPath: string,
  writeTemporary: (temporaryPath: string) => Promise<void>
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.${crypto.randomUUID()}.tmp`
  );
  try {
    await writeTemporary(temporaryPath);
    await fs.promises.copyFile(temporaryPath, destinationPath, fsConstants.COPYFILE_EXCL);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function asArchive(value: unknown): CorosWatchfaceArchive | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record.archive && typeof record.archive === "object"
    ? record.archive as Record<string, unknown>
    : record;
  return typeof candidate.archiveId === "string" ? candidate as unknown as CorosWatchfaceArchive : undefined;
}
