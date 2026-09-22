import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Activity, Bike, ChevronDown, Dumbbell, FileDown, Loader2, MoreVertical } from "lucide-react";
import { PersonSimpleRun, PersonSimpleSwim, PersonSimpleWalk } from "@phosphor-icons/react";
import { activityCategory } from "../activityCollection";
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
import { isSwimSportType, resolveSportName } from "../sportTypes";
import { useUnitSystem } from "../../units/UnitSystemProvider";

interface TrainingActivityTableProps {
  activities: TrainingHubActivity[];
  sportTypes: TrainingHubSportType[];
  selectedActivityId: string | null;
  busy: string | null;
  exportDisabled?: boolean;
  onLoadDetail: (activity: TrainingHubActivity) => void;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

const sportIcons = { run: PersonSimpleRun, ride: Bike, swim: PersonSimpleSwim,
  walk: PersonSimpleWalk, strength: Dumbbell, other: Activity, all: Activity };

function handleRowKeyDown(
  event: KeyboardEvent<HTMLTableRowElement>,
  activity: TrainingHubActivity,
  onLoadDetail: (activity: TrainingHubActivity) => void
) {
  if (event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onLoadDetail(activity);
  }
}

interface ExportMenuProps {
  activity: TrainingHubActivity;
  activityName: string;
  busy: string | null;
  disabled?: boolean;
  compact?: boolean;
  /** Renders a labelled pill trigger instead of the icon-only button. */
  label?: string;
  onExportFile: (
    activity: TrainingHubActivity,
    fileType: TrainingHubActivityFileType
  ) => void;
}

export function ExportMenu({
  activity,
  activityName,
  busy,
  disabled = false,
  compact = false,
  label,
  onExportFile
}: ExportMenuProps) {
  const [menuPosition, setMenuPosition] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
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

    // Right-align under table action columns; left-align for triggers on the
    // left side of the viewport (the dialog footer) so the menu stays on screen.
    setMenuPosition({
      top: rect.bottom + 6,
      ...(rect.left < window.innerWidth / 2
        ? { left: rect.left }
        : { right: window.innerWidth - rect.right })
    });
  }

  // A menu that would run off the bottom of the viewport (e.g. from a dialog
  // footer) flips to open upward once its real height is known.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!open || menuPosition?.top === undefined || !menu || !button) {
      return;
    }
    if (menu.getBoundingClientRect().bottom > window.innerHeight - 8) {
      const { top: _top, ...anchor } = menuPosition;
      setMenuPosition({
        ...anchor,
        bottom: window.innerHeight - button.getBoundingClientRect().top + 6
      });
    }
  }, [open, menuPosition]);

  return (
    <div className="training-export-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        className={label
          ? "secondary-button training-export-button"
          : `icon-button training-action-button${compact ? " activity-card-menu" : ""}`}
        type="button"
        aria-label={`Export ${activityName}`}
        title={disabled ? "Sample activities cannot be exported" : "Export activity file"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || isExporting}
        onClick={(event) => {
          event.stopPropagation();
          toggleMenu();
        }}
      >
        {isExporting ? (
          <Loader2 className="spin" size={17} aria-hidden="true" />
        ) : compact ? <MoreVertical size={18} aria-hidden="true" /> : (
          <>
            <FileDown size={17} aria-hidden="true" />
            {label ? <span>{label}</span> : null}
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
              style={{ top: menuPosition.top, bottom: menuPosition.bottom, left: menuPosition.left, right: menuPosition.right }}
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
            // Inside a modal <dialog> the body is inert, so the menu must live in the dialog's top layer.
            containerRef.current?.closest("dialog") ?? document.body
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
  exportDisabled = false,
  onLoadDetail,
  onExportFile
}: TrainingActivityTableProps) {
  const { unitSystem } = useUnitSystem();
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
      <table aria-label="Activities">
        <thead>
          <tr>
            <th scope="col">Activity</th>
            <th scope="col">Date & time</th>
            <th scope="col">Duration</th>
            <th scope="col">Distance</th>
            <th aria-label="Export" />
          </tr>
        </thead>
        <tbody>
          {activities.map((activity, index) => {
            const sportName = resolveSportName(activity, sportTypeMap);
            const category = activityCategory(activity.sportType);
            const SportIcon = sportIcons[category];
            const activityName =
              activity.name || sportName || `Activity ${index + 1}`;
            const isSelected = selectedActivityId === activity.activityId;
            const isLoadingDetail =
              busy === `training-detail:${activity.activityId}`;

            return (
              <tr
                className={`training-table-row activity-sport-${category}${
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
                  <div className="training-activity-identity">
                    <span className="training-activity-sport-icon"><SportIcon size={21} aria-hidden="true" /></span>
                  <div className="training-activity-name">
                    <strong title={activityName}>{activityName}</strong>
                    <span className="sport-chip">
                      {sportName}
                    </span>
                  </div>
                  </div>
                </td>
                <td className="training-activity-when">
                  {formatTrainingTableWhen(activity.startTime)}
                </td>
                <td className="training-activity-metric">
                  {formatDurationSeconds(activity.duration)}
                </td>
                <td className="training-activity-metric">
                  {formatDistanceMeters(
                    activity.distance,
                    unitSystem,
                    isSwimSportType(activity.sportType)
                  )}
                </td>
                <td className="training-activity-export">
                  <div className="row-actions">
                    <ExportMenu
                      activity={activity}
                      activityName={activityName}
                      busy={busy}
                      disabled={exportDisabled}
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
