// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EcranErrorBoundary } from './EcranErrorBoundary';

function EcranFragile({ plante }: { plante: boolean }) {
  if (plante) throw new Error('écran cassé');
  return <p>Écran intact</p>;
}

afterEach(() => {
  cleanup();
});

describe('frontière d’erreur des écrans', () => {
  it('garde le reste de l’application et propose de réessayer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <EcranErrorBoundary resetKey="pipeline">
        <EcranFragile plante />
      </EcranErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Cet écran a rencontré un problème');

    rerender(
      <EcranErrorBoundary resetKey="pipeline">
        <EcranFragile plante={false} />
      </EcranErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByText('Écran intact')).toBeTruthy();
  });

  it('revient à l’écran suivant quand on change de page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <EcranErrorBoundary resetKey="pipeline">
        <EcranFragile plante />
      </EcranErrorBoundary>,
    );

    rerender(
      <EcranErrorBoundary resetKey="accueil">
        <EcranFragile plante={false} />
      </EcranErrorBoundary>,
    );
    expect(screen.getByText('Écran intact')).toBeTruthy();
  });
});
