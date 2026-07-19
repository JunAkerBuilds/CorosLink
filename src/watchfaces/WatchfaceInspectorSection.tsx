import {
  type ReactNode,
  useId
} from "react";
import { ChevronRight } from "lucide-react";
import type { WatchfaceInspectorSectionId } from "./watchfaceInspectorSections";

interface WatchfaceInspectorSectionProps {
  sectionId: WatchfaceInspectorSectionId;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  actions?: ReactNode;
  status?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function WatchfaceInspectorSection({
  sectionId,
  title,
  open,
  onOpenChange,
  children,
  actions,
  status,
  disabled = false,
  className = ""
}: WatchfaceInspectorSectionProps) {
  const contentId = useId();
  return (
    <section
      className={`wf-property-section${open ? " is-open" : " is-collapsed"}${
        disabled ? " is-disabled" : ""
      }${className ? ` ${className}` : ""}`}
      data-section={sectionId}
    >
      <div className="wf-property-section-header">
        <button
          type="button"
          className="wf-property-section-trigger"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronRight
            className="wf-property-section-chevron"
            size={14}
            aria-hidden="true"
          />
          <span>{title}</span>
          {status ? <span className="wf-property-section-status">{status}</span> : null}
        </button>
        {actions ? <div className="wf-property-section-actions">{actions}</div> : null}
      </div>
      {open ? (
        <div
          id={contentId}
          className="wf-property-section-content"
          aria-disabled={disabled || undefined}
        >
          {disabled ? <fieldset disabled>{children}</fieldset> : children}
        </div>
      ) : null}
    </section>
  );
}
