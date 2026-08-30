import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary caught an error:", error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen grid place-items-center bg-background">
          <div className="bg-card rounded-[22px] p-8 shadow-lg text-center max-w-md">
            <h2 className="text-xl font-bold mb-2">Oups, une erreur est survenue.</h2>
            <p className="text-muted-foreground text-sm">
              Recharge la page ou reconnecte-toi.
            </p>
            <button
              className="primary-gold mt-4"
              onClick={() => window.location.reload()}
            >
              Recharger
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
