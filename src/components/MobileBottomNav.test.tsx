// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileBottomNav } from './MobileBottomNav';

afterEach(() => cleanup());

describe('barre du bas mobile', () => {
  it('ouvre la création d’un lead depuis le plus', () => {
    const onCompose = vi.fn();
    render(
      <MobileBottomNav
        currentNav="accueil"
        onNavigate={vi.fn()}
        onOpenMobileMenu={vi.fn()}
        onOpenNotifications={vi.fn()}
        onOpenNova={vi.fn()}
        onCompose={onCompose}
        composeLabel="Lead"
        composeTitle="Créer un lead"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer un lead' }));
    expect(onCompose).toHaveBeenCalled();
    expect(screen.getByText('Lead')).toBeTruthy();
    expect(screen.getByText('Accueil')).toBeTruthy();
    expect(screen.getByText('Menu')).toBeTruthy();
  });
});
