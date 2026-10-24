import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changer cette clé (écran, fiche, panneau) réaffiche le contenu. */
  resetKey?: string;
  /** Remplit le cadre parent, pour un panneau Nova déjà borné. */
  plein?: boolean;
}

interface State {
  hasError: boolean;
}

// Un écran qui plante ne doit pas remplacer toute la session. Le menu, les
// onglets et les autres panneaux restent utilisables ; changer d'écran
// réinitialise cette frontière.
export class EcranErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Écran interrompu :', error);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private reessayer = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center px-6 text-center ${this.props.plein ? 'h-full' : 'py-24'}`}
      >
        <h2 className="text-lg font-semibold text-white mb-2">Cet écran a rencontré un problème.</h2>
        <p className="text-sm text-gray-400 max-w-md mb-4">
          Le reste de l'application reste disponible. Vous pouvez réessayer, ou ouvrir un autre écran depuis le menu.
        </p>
        <button
          type="button"
          onClick={this.reessayer}
          className="px-4 py-2 rounded-full bg-[#F7BC5F] text-[#1a1230] text-sm font-semibold"
        >
          Réessayer
        </button>
      </div>
    );
  }
}
