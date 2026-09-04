import { useState, useRef } from "react";
import { Mic, Search, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { assemblerDictee } from "@/lib/dictee";
import { useTasks } from "@/hooks/useTasks";
import { useContacts } from "@/hooks/useContacts";
import { creerNote } from "@/lib/novaQuickActions";

/**
 * Demande explicite (28/08/2026) : "je veux que tu intègres Nova dans
 * Immosphera 360 — un bouton Nova qui permet d'avoir simplement une barre
 * horizontale de recherche, et on pourra soit lui parler en dictée vocale,
 * c'est-à-dire qu'il enregistre notre voix et il se la retranscrit pour
 * actionner l'action."
 *
 * Volontairement minimal, PAS le chat complet ni la mini-popup (App.tsx) :
 * une simple barre texte + micro. Recherche de biens (search_properties)
 * en priorité — résultat transmis via `onResults`, qui alimente le MÊME
 * mécanisme déjà prévu dans Immosphera.tsx/Index.tsx (aiResultIds/
 * aiQueryText).
 *
 * Demande explicite (4 septembre) : « retrouver tâches/notes/contacts
 * depuis Immosphera 360 » — cette barre ignorait jusqu'ici silencieusement
 * toute réponse de Nova qui n'était pas une recherche de biens (seul
 * `data.properties` était lu). `useTasks()`/`useContacts()` sont les MÊMES
 * hooks que AssistantIAView.tsx (le chat complet) : create_task/
 * create_contact passent par leurs mutations existantes plutôt que d'être
 * réécrits ici — pas de seconde version de la résolution agence/utilisateur
 * en UUID à maintenir. create_note, plus simple, est partagé via
 * src/lib/novaQuickActions.ts.
 */
export function NovaSearchBar({ onResults }: { onResults: (ids: string[], queryText: string) => void }) {
  const { currentUser, activeAgency } = useAuth() as any;
  const { addTask } = useTasks();
  const { addContact, allContacts } = useContacts();
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
    // Même correctif que Nova (AssistantIAView.tsx) et l'accueil : Android
    // Chrome marque parfois plusieurs segments `isFinal` qui se prolongent
    // l'un l'autre ("j'ai", "j'ai vu"...) — les concaténer tous (comme le
    // faisait ce handler, résultat + interim depuis resultIndex) répète la
    // phrase. `assemblerDictee` (src/lib/dictee.ts) gère déjà ce cas.
    recognition.onresult = (e: any) => {
      setQuery(assemblerDictee(e.results));
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

      // Nova a choisi une action tâche/note/contact plutôt qu'une recherche
      // de biens : on l'exécute et on confirme par un toast, sans toucher à
      // la liste de biens affichée (une réponse vide serait trompeuse — ce
      // n'était pas une recherche).
      const calls: { name: string; args: Record<string, any> }[] = Array.isArray(data.functionCalls) ? data.functionCalls : [];
      const quickAction = calls.find((c) => ["create_task", "create_note", "create_contact"].includes(c.name));
      if (quickAction) {
        const { name, args } = quickAction;
        try {
          if (name === "create_contact") {
            const contactName = typeof args.name === "string" ? args.name : "Nouveau Contact";
            await addContact.mutateAsync({
              name: contactName,
              email: typeof args.email === "string" ? args.email : "",
              phone: typeof args.phone === "string" ? args.phone : "",
              clientType: (typeof args.clientType === "string" ? args.clientType : "other") as any,
              notes: typeof args.notes === "string" ? args.notes : "",
              agencyId: activeAgency?.id,
            } as any);
            toast.success(`Contact créé : ${contactName}`);
          } else if (name === "create_task") {
            const title = typeof args.title === "string" ? args.title : "Nouvelle tâche";
            await addTask.mutateAsync({
              title,
              dueDate: typeof args.dueDate === "string" ? args.dueDate : new Date().toISOString().slice(0, 10),
              completed: false,
              priority: (typeof args.priority === "string" ? args.priority : "Moyenne") as any,
              type: (typeof args.type === "string" ? args.type : "Tâche") as any,
              contactId: typeof args.contactId === "string" ? args.contactId : undefined,
            });
            toast.success(`Tâche ajoutée : ${title}`);
          } else {
            const rawContactId = typeof args.contactId === "string" ? args.contactId : "";
            const matched = rawContactId ? allContacts.find((c: any) => c.id === rawContactId) : undefined;
            const resultat = await creerNote({
              userId: currentUser?.uid,
              agencyId: activeAgency?.id || "",
              title: typeof args.title === "string" ? args.title : undefined,
              content: typeof args.content === "string" ? args.content : "",
              matchedContactId: matched?.id,
              matchedContactName: matched?.name,
              contactName: typeof args.contactName === "string" ? args.contactName : undefined,
            });
            if (!resultat.success) throw new Error(resultat.error || "Écriture refusée.");
            toast.success(resultat.title);
          }
        } catch (e: any) {
          toast.error(e?.message || "Nova n'a pas pu réaliser cette action.");
        }
        return;
      }

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
