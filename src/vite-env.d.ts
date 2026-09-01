/// <reference types="vite/client" />

declare var SpeechRecognition: any;
declare var webkitSpeechRecognition: any;

type SpeechRecognitionErrorEvent = any;
type SpeechRecognitionEvent = any;

// Injecté au build par vite.config.ts (define) : branche, commit et heure du
// paquet réellement chargé par le navigateur.
declare const __BUILD_INFO__: { ref: string; sha: string; at: string };
