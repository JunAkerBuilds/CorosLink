import { geoEquirectangular, geoPath, type GeoPermissibleObjects } from "d3-geo";
import type { GeometryCollection, Topology } from "topojson-specification";
import { feature } from "topojson-client";
import landAtlas from "world-atlas/land-110m.json";

interface LandGeometryMessage {
  positions: ArrayBuffer;
  strengths: ArrayBuffer;
}

type LandTopology = Topology<{ land: GeometryCollection }>;

const LAND_DOT_STEP_DEGREES = 1;
const GLOBE_RADIUS = 100;
const SURFACE_ALTITUDE = 0.0025;
const MASK_WIDTH = 1440;
const MASK_HEIGHT = 720;

function coordinateToVector(
  lat: number,
  lng: number,
  radius: number,
): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((90 - lng) * Math.PI) / 180;
  return [
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

function buildLandGeometry(): LandGeometryMessage {
  const topology = landAtlas as unknown as LandTopology;
  const land = feature(topology, topology.objects.land);
  const raster = new OffscreenCanvas(MASK_WIDTH, MASK_HEIGHT);
  const context = raster.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to create the geography mask.");
  }

  const projection = geoEquirectangular().fitExtent(
    [
      [0, 0],
      [MASK_WIDTH, MASK_HEIGHT],
    ],
    { type: "Sphere" },
  );
  context.fillStyle = "#fff";
  context.beginPath();
  geoPath(
    projection,
    context as unknown as CanvasRenderingContext2D,
  )(land as GeoPermissibleObjects);
  context.fill();

  const pixels = context.getImageData(0, 0, MASK_WIDTH, MASK_HEIGHT).data;
  const coordinates: number[] = [];
  for (let row = 0; ; row += 1) {
    const lat = -84 + row * LAND_DOT_STEP_DEGREES;
    if (lat > 84) {
      break;
    }

    const lonStep =
      LAND_DOT_STEP_DEGREES /
      Math.max(Math.cos((lat * Math.PI) / 180), 0.08);
    for (
      let lon = -180 + (row % 2) * lonStep * 0.5;
      lon < 180;
      lon += lonStep
    ) {
      const projected = projection([lon, lat]);
      if (!projected) {
        continue;
      }
      const x = Math.min(
        MASK_WIDTH - 1,
        Math.max(0, Math.round(projected[0])),
      );
      const y = Math.min(
        MASK_HEIGHT - 1,
        Math.max(0, Math.round(projected[1])),
      );
      if (pixels[(y * MASK_WIDTH + x) * 4 + 3]! > 128) {
        coordinates.push(lon, lat);
      }
    }
  }

  const pointCount = coordinates.length / 2;
  const positions = new Float32Array(pointCount * 3);
  const strengths = new Float32Array(pointCount);
  const radius = GLOBE_RADIUS * (1 + SURFACE_ALTITUDE);
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const [x, y, z] = coordinateToVector(
      coordinates[pointIndex * 2 + 1]!,
      coordinates[pointIndex * 2]!,
      radius,
    );
    positions[pointIndex * 3] = x;
    positions[pointIndex * 3 + 1] = y;
    positions[pointIndex * 3 + 2] = z;
    strengths[pointIndex] =
      0.72 + (((pointIndex * 2_654_435_761) >>> 0) % 997) / 3_560;
  }

  return {
    positions: positions.buffer,
    strengths: strengths.buffer,
  };
}

const message = buildLandGeometry();
const workerScope = self as unknown as {
  postMessage: (message: LandGeometryMessage, transfer: Transferable[]) => void;
};
workerScope.postMessage(message, [message.positions, message.strengths]);

