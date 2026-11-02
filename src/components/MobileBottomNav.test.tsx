// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNav, MobileTopPlus } from './MobileBottomNav';

afterEach(() => cleanup());

describe('barre du bas mobile', () => {
  it('contient Accueil, +, Nova, Recherche et Paramètres', () => {
    render(
      <MobileBottomNav
        currentNav="accueil"
        onNavigate={vi.fn()}
        onOpenMobileMenu={vi.fn()}
        onOpenNotifications={vi.fn()}
        onOpenNova={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Accueil' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nova' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Créer un lead' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rechercher' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Paramètres' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('affiche le bouton micro de dictée vocale au-dessus de Nova quand fourni', () => {
    const onOpenDictation = vi.fn();
    render(
      <MobileBottomNav
        currentNav="accueil"
        onNavigate={vi.fn()}
        onOpenMobileMenu={vi.fn()}
        onOpenNotifications={vi.fn()}
        onOpenNova={vi.fn()}
        onOpenDictation={onOpenDictation}
      />,
    );
    const micBtn = screen.getByRole('button', { name: /Dictée vocale/i });
    expect(micBtn).toBeTruthy();
    fireEvent.click(micBtn);
    expect(onOpenDictation).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });

  it('ouvre la création d’un lead depuis le plus en haut', () => {
    const onClick = vi.fn();
    render(<MobileTopPlus onClick={onClick} label="Créer un lead" />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un lead' }));
    expect(onClick).toHaveBeenCalled();
  });
});
