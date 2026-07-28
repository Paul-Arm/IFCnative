import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Crash-Boundary: fängt Renderfehler, bietet Weiterarbeiten ohne Reload an. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI-Fehler:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24 }}>
          <h2>Unerwarteter Fehler</h2>
          <p className="text-dim">{String(this.state.error)}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Weiterarbeiten
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
