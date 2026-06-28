import { FileDown, Loader2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import type {
  TrainingHubActivity,
  TrainingHubActivityFileType,
  TrainingHubSportType
} from "../../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatTrainingTableWhen
} from "../formatters";

interface TrainingActivityTableProps {
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  selectedActivityId: string | null;
  busy: string | null;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onGetFileUrl: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

function resolveSportName(
  activity: TrainingHubActivity,
  sportTypeMap: Map<number, string>
): string {
  return (
    activity.sportName ??
    sportTypeMap.get(activity.sportType) ??
    `Sport ${activity.sportType}`
  );
}

function sportChipClass(sportType: number): string {
  const palette = sportType % 5;
  return `sport-chip sport-chip-${palette}`;
}

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  activity: TrainingHubActivity,
  onLoadDetail: (activity: TrainingHubActivity) => void
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onLoadDetail(activity);
  }
}

export function TrainingActivityTable({
  activities,
  sportTypes,
  selectedActivityId,
  busy,
  onLoadDetail,
  onGetFileUrl
}: TrainingActivityTableProps) {
  const sportTypeMap = new Map(
    sportTypes.map((item) => [item.sportType, item.sportName])
  );

  if (activities.length === 0) {
    return (
      <div className="training-empty-state">
        <p>No Training Hub activities loaded.</p>
      </div>
    );
  }

  return (
    <div className="table-shell training-activity-table-shell">
      <table>
        <thead>
          <tr>
            <th>Activity</th>
            <th>When</th>
            <th>Time</th>
            <th>Dist</th>
            <th aria-label="Export" />
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => {
            const sportName = resolveSportName(activity, sportTypeMap);
            const activityName =
              activity.name || sportName || `Activity ${index + 1}`;
            const isSelected = selectedActivityId === activity.activityId;
            const isLoadingDetail =
              busy === `training-detail:${activity.activityId}`;

            return (
              <tr
                className={`training-table-row${
                  isSelected ? " is-selected" : ""
                }${isLoadingDetail ? " is-loading" : ""}`}
                key={activity.activityId || `${activity.sportType}-${index}`}
                role="button"
                tabIndex={0}
                aria-selected={isSelected}
                aria-label={`View details for ${activityName}`}
                onClick={() => onLoadDetail(activity)}
                onKeyDown={(event) =>
                  handleRowKeyDown(event, activity, onLoadDetail)
                }
              >
                <td className="training-activity-cell">
                  <div className="training-activity-name">
                    <strong title={activityName}>{activityName}</strong>
                    <span className={sportChipClass(activity.sportType)}>
                      {sportName}
                    </span>
                  </div>
                </td>
                <td className="training-activity-when">
                  {formatTrainingTableWhen(activity.startTime)}
                </td>
                <td className="training-activity-metric">
                  {formatDurationSeconds(activity.duration)}
                </td>
                <td className="training-activity-metric">
                  {formatDistanceMeters(activity.distance)}
                </td>
                <td className="training-activity-export">
                  <div className="row-actions">
                    <button
                      className="icon-button training-action-button"
                      type="button"
                      aria-label={`Get FIT file URL for ${activityName}`}
                      title="Get FIT file URL"
                      disabled={busy === `training-file:${activity.activityId}:4`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onGetFileUrl(activity, 4);
                      }}
                    >
                      {busy === `training-file:${activity.activityId}:4` ? (
                        <Loader2 className="spin" size={17} aria-hidden="true" />
                      ) : (
                        <FileDown size={17} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
