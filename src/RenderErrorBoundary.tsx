import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { t } from "./i18n";

interface RenderErrorBoundaryProps {
  children: ReactNode;
  /** English source of the heading; translated when shown. */
  title: string;
  /** A new value (the active view) clears the error so the user can move on. */
  resetKey?: unknown;
  /** Offer a full window reload instead of re-rendering the same tree. */
  reload?: boolean;
}

interface RenderErrorBoundaryState {
  error: Error | null;
  resetKey: unknown;
}

/**
 * Keeps a render error inside one part of the window. Without it React
 * unmounts the whole app, which on macOS leaves an empty frosted window.
 * Uses the global .empty-state: a lazy view's own stylesheet may be exactly
 * what failed to load. The root's onCaughtError logs and reports the error.
 */
export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<RenderErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RenderErrorBoundaryProps,
    state: RenderErrorBoundaryState,
  ): Partial<RenderErrorBoundaryState> | null {
    if (Object.is(props.resetKey, state.resetKey)) return null;
    return { error: null, resetKey: props.resetKey };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="empty-state" role="alert">
        <AlertCircle size={28} aria-hidden="true" />
        <strong>{t(this.props.title)}</strong>
        <span>{error.message}</span>
        <button
          type="button"
          className="primary-button"
          onClick={() =>
            this.props.reload
              ? window.location.reload()
              : this.setState({ error: null })
          }
        >
          {this.props.reload ? t("Reload") : t("Try again")}
        </button>
      </section>
    );
  }
}
