// Maps (desktop only), answered at /api/desktop/maps: hands each path to the part that owns it (docs/maps-port.md).
// Route Studio (routesService), the watch with Map areas and route sync (areasService), COROS Maps (packagesService).
import path from "node:path";
import type { Sealer } from "../secrets";
import type { WatchDrive } from "../media/watchDrive";
import type { LocalWatch } from "../watch/service";
import { AreasService } from "./areasService";
import { areasDrive } from "./areas/usb";
import { PackagesService } from "./packagesService";
import { RoutesService } from "./routesService";
import { t } from "@/lib/i18n";

export interface MapsHost {
  /** The app's data folder: maps keeps `maps/routes`, `maps/areas` and `maps/packages` in it. */
  data: string;
  sealer: Sealer;
  watch: () => LocalWatch | null;
  drive: WatchDrive;
  log?: (line: string) => void;
}

const PREFIX = "/api/desktop/maps";

export class MapsService {
  readonly routes: RoutesService;
  readonly areas: AreasService;
  readonly packages: PackagesService;

  constructor(host: MapsHost) {
    const folder = (name: string) => path.join(host.data, "maps", name);
    const drive = areasDrive(host.drive);
    this.areas = new AreasService({
      folder: folder("areas"),
      watch: host.watch,
      drive: () => drive,
      route: async (id) => {
        const r = await this.routes.route(id);
        return r ? { id: r.id, name: r.name, points: r.points, distanceM: r.distanceM, ascentM: r.ascentM, descentM: r.descentM, createdAt: r.createdAt } : null;
      },
      log: host.log,
    });
    this.routes = new RoutesService({ folder: folder("routes"), sealer: host.sealer, onWatch: (id) => this.areas.onWatch(id) });
    this.packages = new PackagesService({
      folder: folder("packages"),
      drive: () => ({
        watch: async () => {
          const status = await host.drive.status();
          const root = status.connected ? await drive.root() : null;
          return root ? { root, model: status.model, freeBytes: status.freeBytes } : null;
        },
        exclusive: (work) => host.drive.exclusive(work),
        invalidate: () => host.drive.invalidate(),
      }),
      log: host.log,
    });
  }

  async answer(request: Request): Promise<Response> {
    const sub = new URL(request.url).pathname.slice(PREFIX.length) || "/";
    try {
      // Route sync and the watch's routes belong to the watch side; ask it before Route Studio's /routes/*.
      for (const part of [this.areas, this.packages, this.routes]) {
        const answer = await part.answer(request, sub);
        if (answer) return answer;
      }
      return Response.json({ error: { code: "notFound", message: t("Maps has nothing at that address.") } }, { status: 404 });
    } catch (error) {
      console.error(`Maps ${request.method} ${sub} failed:`, error);
      return Response.json({ error: { code: "problem", message: error instanceof Error ? error.message : t("Maps couldn't do that.") } }, { status: 500 });
    }
  }
}
