import { Component, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("Dashboard render failed", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-fallback" role="alert">
          <section className="panel app-fallback__panel">
            <span className="app-fallback__icon">
              <Icon name="alert" size={22} />
            </span>
            <div>
              <span className="eyebrow">页面异常</span>
              <h1>预测面板未能正常渲染</h1>
              <p>
                当前数据快照或本地状态可能不完整。可以刷新页面，或在数据更新中心恢复内置快照后重新模拟。
              </p>
              <code>{this.state.error.message}</code>
              <button
                className="primary-action"
                onClick={() => window.location.reload()}
                type="button"
              >
                <Icon name="refresh" size={16} />
                重新加载
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
