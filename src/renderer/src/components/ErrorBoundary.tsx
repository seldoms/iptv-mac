import { Component, type ErrorInfo, type ReactNode } from 'react'
import AppLogo from './AppLogo/AppLogo'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * React Error Boundary — 捕获子组件未处理异常，显示友好错误页面而非白屏。
 * 包裹 <Routes> 区域即可对全路由生效。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] 未捕获异常:', error, info.componentStack)
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-bg-primary text-text-primary p-8">
          <div className="max-w-md text-center space-y-6">
            <AppLogo className="w-20 h-20" />

            <h1 className="text-xl font-semibold">应用出现异常</h1>

            <p className="text-sm text-text-secondary">
              很抱歉，应用遇到了一个意外错误。请尝试刷新页面或稍后重试。
            </p>

            {isDev && this.state.error && (
              <details className="text-left bg-bg-secondary rounded-lg p-4 max-h-48 overflow-auto">
                <summary className="cursor-pointer text-sm font-mono text-accent mb-2">
                  错误详情（开发模式）
                </summary>
                <pre className="text-xs text-text-secondary whitespace-pre-wrap break-all">
                  {this.state.error.name}: {this.state.error.message}
                  {'\n'}
                  {this.state.error.stack}
                </pre>
              </details>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-5 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 transition-opacity"
              >
                重试
              </button>
              <button
                onClick={this.handleReload}
                className="px-5 py-2 rounded-lg bg-bg-tertiary text-text-primary text-sm font-medium hover:opacity-90 transition-opacity"
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}