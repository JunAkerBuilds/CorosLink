import {
  Download,
  Loader2,
  QrCode,
  Route as RouteIcon,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import type { GeneratedRoutePage, GeneratedRouteSummary } from "../../../electron/types";
import { formatDate } from "../../media/libraryUtils";
import { ROUTE_ACTIVITY_OPTIONS } from "./constants";
import { activityTypeLabel, formatDistance } from "./utils";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { distanceUnit } from "../../units/units";

/** Auto-dismiss window for the two-tap delete confirmation. */
const DELETE_CONFIRM_MS = 3000;

export function SavedRoutesDrawer({
  open,
  page,
  loading,
  selectingId,
  onPageChange,
  activeId,
  busyId,
  onClose,
  onSelect,
  onExport,
  onShare,
  onDelete
}: {
  open: boolean;
  page: GeneratedRoutePage;
  loading: boolean;
  selectingId: string | null;
  onPageChange: (offset: number) => void;
  activeId: string | null;
  busyId: string | null;
  onClose: () => void;
  onSelect: (route: GeneratedRouteSummary) => void;
  onExport: (route: GeneratedRouteSummary) => void;
  onShare: (route: GeneratedRouteSummary) => void;
  onDelete: (route: GeneratedRouteSummary) => void;
}) {
  const { routes, total, offset, pageSize } = page;
  const { unitSystem } = useUnitSystem();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // The delete confirmation arms briefly, then reverts on its own.
  useEffect(() => {
    if (!confirmDeleteId) {
      return;
    }
    const timer = setTimeout(() => setConfirmDeleteId(null), DELETE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  return (
    <aside className={`route-drawer${open ? " is-open" : ""}`} aria-hidden={!open}>
      <div className="route-drawer-head">
        <div>
          <p className="eyebrow">Saved routes</p>
          <h3>{total} route{total === 1 ? "" : "s"}</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close saved routes"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {loading && routes.length === 0 ? <p role="status">Loading saved routes…</p> : routes.length === 0 ? (
        <div className="route-drawer-empty">
          <RouteIcon size={28} aria-hidden="true" />
          <p>No saved routes yet.</p>
          <small>Generate or draw a route, then save it to see it here.</small>
        </div>
      ) : (
        <ul key={offset} className="route-drawer-list" aria-busy={loading}>
          {routes.map((route) => {
            const busy = busyId === route.id;
            const confirming = confirmDeleteId === route.id;
            const ActivityIcon =
              ROUTE_ACTIVITY_OPTIONS.find(
                (option) => option.value === route.activityType
              )?.icon ?? RouteIcon;
            return (
              <li
                key={route.id}
                className={route.id === activeId ? "is-active" : ""}
              >
                <span className="route-card-icon" aria-hidden="true">
                  <ActivityIcon size={15} />
                </span>
                <button
                  type="button"
                  className="route-card-main"
                  disabled={loading || selectingId === route.id}
                  onClick={() => onSelect(route)}
                >
                  <strong className="route-card-name">{route.name}</strong>
                  {selectingId === route.id ? <span role="status">Loading preview…</span> : null}
                  <span className="route-card-meta">
                    {formatDistance(route.distanceMeters, unitSystem)} {distanceUnit(unitSystem)} ·{" "}
                    {activityTypeLabel(route.activityType)} ·{" "}
                    {route.mode === "loop" ? "Loop" : "A → B"}
                  </span>
                  <small className="route-card-date">
                    {formatDate(route.createdAt)}
                  </small>
                </button>
                <div className="route-card-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title="Export GPX"
                    aria-label={`Export ${route.name} as GPX`}
                    disabled={busy}
                    onClick={() => onExport(route)}
                  >
                    {busy ? (
                      <Loader2 size={15} className="spin" aria-hidden="true" />
                    ) : (
                      <Download size={15} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    title="Share to phone"
                    aria-label={`Share ${route.name} to phone`}
                    onClick={() => onShare(route)}
                  >
                    <QrCode size={15} aria-hidden="true" />
                  </button>
                  {confirming ? (
                    <button
                      type="button"
                      className="route-card-confirm-delete"
                      onClick={() => {
                        setConfirmDeleteId(null);
                        onDelete(route);
                      }}
                    >
                      Delete?
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-button danger"
                      title="Delete route"
                      aria-label={`Delete ${route.name}`}
                      onClick={() => setConfirmDeleteId(route.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {total > 0 ? (
        <nav className="route-drawer-pagination" aria-label="Saved route pages">
          <button type="button" className="button ghost" disabled={loading || offset === 0}
            onClick={() => onPageChange(offset - pageSize)}>Previous</button>
          <span role="status">{loading ? "Loading…" : `${offset + 1}–${offset + routes.length} of ${total}`}</span>
          <button type="button" className="button ghost" disabled={loading || offset + routes.length >= total}
            onClick={() => onPageChange(offset + pageSize)}>Next</button>
        </nav>
      ) : null}
    </aside>
  );
}
