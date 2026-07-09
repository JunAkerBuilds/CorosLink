import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileDown, Loader2 } from "lucide-react";
import type { KeyboardEvent } from "react";
import {
  TRAINING_HUB_EXPORT_FORMATS,
  type TrainingHubActivity,
  type TrainingHubActivityFileType,
  type TrainingHubSportType
} from "../../../electron/types";
import {
  formatDistanceMeters,
  formatDurationSeconds,
  formatTrainingTableWhen
} from "../formatters";
import { resolveSportName } from "../sportTypes";

interface TrainingActivityTableProps {
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  selectedActivityId: string | null;
  busy: string | null;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
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

interface ExportMenuProps {
  activity: TrainingHubActivity;
  activityName: string;
  busy: string | null;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

function ExportMenu({
  activity,
  activityName,
  busy,
  onExportFile
}: ExportMenuProps) {
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = menuPosition !== null;
  const isExporting = busy?.startsWith(
    `training-file:${activity.activityId}:`
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function close() {
      setMenuPosition(null);
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      // The menu is portaled to <body>, so check it explicitly as well.
      if (
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        close();
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    // The activity list scrolls inside a clipped container, so a fixed menu can
    // drift away from its trigger — close it instead of tracking every frame.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggleMenu() {
    if (open) {
      setMenuPosition(null);
      return;
    }

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setMenuPosition({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right
    });
  }

  return (
    <div className="training-export-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        className="icon-button training-action-button"
        type="button"
        aria-label={`Export ${activityName}`}
        title="Export activity file"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isExporting}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
      >
        {isExporting ? (
          <Loader2 className="spin" size={17} aria-hidden="true" />
        ) : (
          <>
            <FileDown size={17} aria-hidden="true" />
            <ChevronDown size={13} aria-hidden="true" />
          </>
        )}
      </button>

      {menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              className="training-export-dropdown"
              role="menu"
              style={{ top: menuPosition.top, right: menuPosition.right }}
            >
              <p className="training-export-dropdown-title">Export as</p>
              {TRAINING_HUB_EXPORT_FORMATS.map((format) => (
                <button
                  key={format.fileType}
                  type="button"
                  role="menuitem"
                  className="training-export-option"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuPosition(null);
                    onExportFile(activity, format.fileType);
                  }}
                >
                  <span className="training-export-option-label">
                    {format.label}
                  </span>
                  <span className="training-export-option-desc">
                    {format.description}
                  </span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function TrainingActivityTable({
  activities,
  sportTypes,
  selectedActivityId,
  busy,
  onLoadDetail,
  onExportFile
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
                    <ExportMenu
                      activity={activity}
                      activityName={activityName}
                      busy={busy}
                      onExportFile={onExportFile}
                    />
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
