import { Component, type ErrorInfo, type ReactNode } from "react";
import { TRUNCATE_ERROR } from "../../lib/constants";

type Props = {
  children: ReactNode;
  title?: string;
  onReset?: () => void;
};

type State = {
  error: Error | null;
};

/** 捕获子树渲染错误，避免整页白屏。 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 bg-[var(--bg-app)] px-6 text-center">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {this.props.title ?? "界面渲染出现问题"}
          </p>
          <p className="max-w-md text-xs text-[var(--text-muted)]">
            {this.state.error.message.slice(0, TRUNCATE_ERROR) || "未知错误"}
          </p>
          <button type="button" className="yt-btn-primary px-4 py-2 text-sm" onClick={this.reset}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
