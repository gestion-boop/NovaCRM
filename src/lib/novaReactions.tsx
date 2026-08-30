import type { ReactNode } from 'react';

/**
 * Demande explicite (suite ticket #240) : dans les sélecteurs de réaction
 * rapide du chat, les mini-expressions Nova apparaissent EN PREMIER, avant
 * les emojis Unicode classiques ("les vrais"). Stockées telles quelles dans
 * la colonne `emoji` (texte libre, déjà utilisée pour n'importe quel emoji
 * Unicode) sous forme de chemin d'asset — `renderEmojiOrNova` ci-dessous
 * distingue les deux au rendu (texte brut vs <img>), à la fois dans le
 * sélecteur et dans les pastilles de réaction déjà posées sur un message.
 */
// Demandé (30/08/2026) : planche complète de 10 "novadji" fournie par
// l'utilisateur, en remplacement intégral de l'ancien jeu de 7 (mélange de
// sources/styles différents) — extraite ici en 10 fichiers séparés (voir
// public/nova/expressions/nova-novadji-*.webp), fond transparent d'origine
// conservé tel quel (aucun détourage nécessaire, contrairement à
// nova-important-alerte.png plus bas dans AnnouncementBanner.tsx). Le
// "cœur" resté en attente au ticket #260 est enfin couvert (amour +
// cœur brisé).
// Revu (30/08/2026, demande explicite "gagner du temps pour l'envoi et la
// réception") : chaque image pesait 400-750 Ko en PNG pour un affichage à
// 28-220px dans le chat — redimensionnées à 480px de côté max et converties
// en WebP (qualité 90, alpha conservé), ~45 Ko en moyenne (÷13). Mêmes
// chemins que ceux déjà envoyés dans les messages/réactions existants,
// seule l'extension change.
export const NOVA_QUICK_REACTIONS = [
  '/nova/expressions/nova-novadji-rire.webp',
  '/nova/expressions/nova-novadji-amour.webp',
  '/nova/expressions/nova-novadji-ange.webp',
  '/nova/expressions/nova-novadji-clin-oeil-pouce.webp',
  '/nova/expressions/nova-novadji-cool.webp',
  '/nova/expressions/nova-novadji-idee.webp',
  '/nova/expressions/nova-novadji-danger.webp',
  '/nova/expressions/nova-novadji-coeur-brise.webp',
  '/nova/expressions/nova-novadji-perplexe.webp',
  '/nova/expressions/nova-novadji-dodo.webp',
];

export function isNovaReaction(value: string): boolean {
  return value.startsWith('/nova/');
}

export function renderEmojiOrNova(value: string, sizeClass = 'w-5 h-5'): ReactNode {
  if (isNovaReaction(value)) {
    return <img src={value} alt="Nova" className={`${sizeClass} inline-block align-middle object-contain`} />;
  }
  return value;
}
