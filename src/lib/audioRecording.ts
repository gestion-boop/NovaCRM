// Choix du format d'enregistrement des messages vocaux — partagé par les 5
// écrans qui enregistrent un vocal (ChatViewSupabase, InternalProjectBoard,
// ClientProfileView, ClientGuestShell) pour que le comportement reste
// identique partout.
//
// Signalé (9 septembre, Natacha) : « elle ne peut pas relire son propre
// vocal, ni écouter ceux des autres — la barre défile mais pas de son ».
// Cause trouvée : chaque écran forçait `audio/webm` (au mieux
// `audio/webm;codecs=opus`), un conteneur/codec que Safari/iOS ne sait pas
// décoder — le lecteur `<audio>` parvient quand même à lire les métadonnées
// du conteneur WebM (durée, curseur de lecture), d'où une barre qui défile
// normalement, mais échoue silencieusement au décodage audio (aucun son,
// aucune erreur visible). Résultat identique à l'émission et à la
// réception puisque tous les écrans partagent le même mécanisme.
//
// Correctif : tester d'abord un format MP4/AAC (le seul que Safari/iOS sait
// à la fois enregistrer ET relire), puis se rabattre sur WebM/Opus ailleurs
// (Chrome/Android/Firefox ne proposent pas l'enregistrement MP4 et
// continuent donc d'utiliser WebM comme avant — aucun changement pour eux).
const VOICE_MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

export function pickVoiceMimeType(): string {
  for (const type of VOICE_MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) {
        return type;
      }
    } catch {
      // MediaRecorder.isTypeSupported peut lever sur certains anciens
      // navigateurs — on continue simplement sur le candidat suivant.
    }
  }
  return 'audio/webm';
}
