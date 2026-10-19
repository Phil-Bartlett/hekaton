import { Component } from "react";
import CaptionButtons from "./CaptionButtons.jsx";

// Windows are frameless, so a render error that unmounts the tree also takes
// the caption buttons with it and leaves a blank window that cannot even be
// closed. This keeps a title bar up and offers a reload; main still holds the
// real state (and a session's pty), so a reload picks up where it left off.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <>
        <header className="title-bar">
          <span className="title-bar__name">Hekaton</span>
          <span className="title-bar__facts" />
          <CaptionButtons platform={document.documentElement.dataset.platform} maximized={false} />
        </header>
        <main className="crash" role="alert">
          <h1 className="crash__title">This window hit an error</h1>
          <pre className="crash__message">{String(error?.stack ?? error)}</pre>
          <button type="button" className="crash__reload" onClick={() => window.location.reload()}>
            Reload window
          </button>
        </main>
      </>
    );
  }
}
