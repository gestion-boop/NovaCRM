import { useState, useRef } from "react";
import { Mic, Search, Square, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Demande explicite (28/08/2026) : "je veux que tu intègres Nova dans
 * Immosphera 360 — un bouton Nova qui permet d'avoir simplement une barre
 * horizontale de recherche, et on pourra soit lui parler en dictée vocale,
 * c'est-à-dire qu'il enregistre notre voix et il se la retranscrit pour
 * actionner l'action."
 *
 * Volontairement minimal, PAS le chat complet ni la mini-popup (App.tsx) :
 * une simple barre texte + micro, dédiée à la recherche de biens
 * (search_properties, déjà l'outil Nova le plus pertinent ici). Résultat
 * transmis via `onResults`, qui alimente le MÊME mécanisme déjà prévu (mais
 * jamais branché) dans Immosphera.tsx/Index.tsx (aiResultIds/aiQueryText).
 */
export function NovaSearchBar({ onResults }: { onResults: (ids: string[], queryText: string) => void }) {
  const { currentUser, activeAgency } = useAuth() as any;
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleVoice = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    recognition.lang = "fr-FR";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      setQuery((finalText + " " + interim).trim());
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const runSearch = async () => {
    const text = query.trim();
    if (!text || loading) return;
    setLoading(true);
    try {
      const token = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
      const res = await fetch("/api/ai/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          prompt: text,
          messages: [],
          context: {
            currentDate: new Date().toISOString(),
            activeAgency: activeAgency ? { id: activeAgency.id, name: activeAgency.name } : undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.properties) && data.properties.length > 0) {
        onResults(data.properties.map((p: any) => p.id), text);
      } else {
        onResults([], text);
      }
    } catch (err) {
      console.warn("Erreur recherche Nova (Immosphera360) :", err);
    } finally {
      setLoading(false);
      setQuery("");
      setExpanded(false);
    }
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        title="Rechercher avec Nova (texte ou voix)"
        className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full overflow-hidden shadow-2xl border-2 border-[#FAD592] bg-gradient-to-br from-[#F7BC5F] to-[#B8863F] hover:brightness-110 transition-all"
        style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover scale-110" />
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-lg flex items-center gap-2 bg-card/95 backdrop-blur-md border border-border/60 rounded-full shadow-2xl px-2 py-2"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
        <img src="/nova-mascotte.png" alt="Nova" className="w-full h-full object-cover scale-110" />
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); if (e.key === "Escape") setExpanded(false); }}
        placeholder="Maison 4 chambres avec piscine à Narbonne..."
        className="flex-1 bg-transparent outline-none text-sm min-w-0"
      />
      <button
        onClick={toggleVoice}
        title={listening ? "Arrêter la dictée" : "Dictée vocale"}
        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          listening ? "bg-rose-500/20 text-rose-500 animate-pulse" : "bg-foreground/5 hover:bg-foreground/10"
        }`}
      >
        {listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
      </button>
      <button
        onClick={() => void runSearch()}
        disabled={!query.trim() || loading}
        title="Rechercher"
        className="w-9 h-9 shrink-0 rounded-full bg-[#F7BC5F] hover:bg-[#F9C977] disabled:opacity-40 text-slate-950 flex items-center justify-center transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default NovaSearchBar;
