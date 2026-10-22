// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENCIES } from '@/types';
import { AgencesAnnonce, NiveauxAnnonce } from './ChoixAnnonce';

const conseils = AGENCIES.find((agence) => agence.name === 'Conseils Finances')!;
const novavisio = AGENCIES.find((agence) => agence.name === 'Novavisio')!;

afterEach(() => cleanup());

describe('choix d’annonce', () => {
  it('n’affiche que l’agence ouverte', () => {
    render(<AgencesAnnonce agencyId={conseils.id} selectedIds={[conseils.id]} onToggle={() => {}} />);
    expect(screen.getByText('Conseils Finances')).toBeTruthy();
    expect(screen.queryByText('Novavisio')).toBeNull();
    expect(screen.queryByText('Immosphera')).toBeNull();
    expect(screen.queryByRole('button', { name: /Conseils Finances/ })).toBeNull();
  });

  it('dans la vue toutes les sociétés, chaque société se coche en un toucher', () => {
    const onToggle = vi.fn();
    render(<AgencesAnnonce agencyId="all" selectedIds={[conseils.id]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Novavisio/ }));
    expect(onToggle).toHaveBeenCalledWith(novavisio.id);
    expect(screen.getByText('Immosphera')).toBeTruthy();
  });

  it('change le niveau en un toucher', () => {
    const onChange = vi.fn();
    render(<NiveauxAnnonce value="info" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Important' }));
    expect(onChange).toHaveBeenCalledWith('important');
    expect(screen.getByRole('button', { name: 'Réponse' }).getAttribute('title')).toBe('Réponse demandée SVP');
  });

  it('propose la signature du compromis avant celle de l’acte authentique', () => {
    render(<NiveauxAnnonce value="info" onChange={() => {}} />);
    const libelles = screen.getAllByRole('button').map((bouton) => bouton.textContent);
    const compromis = libelles.indexOf('Signature compromis');
    const acte = libelles.indexOf('Signature acte authentique');
    expect(compromis).toBeGreaterThanOrEqual(0);
    expect(acte).toBeGreaterThan(compromis);
  });
});
