import { getTrainingHubStatus } from "../trainingHubService";
import { usingLocalSources } from "./activitySource";

/**
 * Whether activity data can be read: from this computer in Local-Only Mode,
 * otherwise from a signed-in COROS Training Hub session.
 */
export function trainingDataAvailable(): boolean {
  if (usingLocalSources()) return true;
  try {
    return getTrainingHubStatus().authenticated;
  } catch {
    return false;
  }
}
