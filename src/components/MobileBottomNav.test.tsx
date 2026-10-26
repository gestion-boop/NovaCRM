// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNav, MobileTopPlus } from './MobileBottomNav';

afterEach(() => cleanup());

describe('barre du bas mobile', () => {
  it('ne garde que Accueil, Nova et Menu', () => {
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
    expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Créer un lead' })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
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
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('ouvre la création d’un lead depuis le plus en haut', () => {
    const onClick = vi.fn();
    render(<MobileTopPlus onClick={onClick} label="Créer un lead" />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un lead' }));
    expect(onClick).toHaveBeenCalled();
  });
});
