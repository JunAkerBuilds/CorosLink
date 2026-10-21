import type { FitActivity } from "../fitActivity";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character]!);
}

/** GPX 1.1 track from a decoded FIT file's GPS records (offline export). */
export function buildGpx(activity: FitActivity, name: string): string {
  const points = activity.records
    .filter(record => record.lat !== undefined && record.lon !== undefined)
    .map(record => {
      const elevation = record.alt !== undefined ? `<ele>${record.alt.toFixed(1)}</ele>` : "";
      const heartRate = record.hr !== undefined
        ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${Math.round(record.hr)}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
        : "";
      return `<trkpt lat="${record.lat!.toFixed(7)}" lon="${record.lon!.toFixed(7)}">${elevation}<time>${new Date(record.ts * 1000).toISOString()}</time>${heartRate}</trkpt>`;
    });
  if (points.length === 0) throw new Error("This activity has no GPS track to export as GPX.");
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<gpx version=\"1.1\" creator=\"CorosLink\" xmlns=\"http://www.topografix.com/GPX/1/1\" xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\">",
    `<trk><name>${escapeXml(name)}</name><trkseg>`,
    ...points,
    "</trkseg></trk></gpx>",
    ""
  ].join("\n");
}
