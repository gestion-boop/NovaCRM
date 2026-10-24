import React, { useState } from 'react';
import { Zap, Send, Bot, Sparkles, User } from 'lucide-react';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
}

const INITIAL_AI_MESSAGES: Message[] = [
  {
    id: 'ai-1',
    sender: 'ai',
    text: 'Bonjour Sylvain ! Je suis l\'assistant IA NovaSphere. Je peux vous aider à rédiger des fiches de synthèse de prêt, générer des descriptions d\'annonces immobilières ou analyser la capacité d\'emprunt d\'un client.',
  },
];

export const AssistantIAView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>(INITIAL_AI_MESSAGES);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || loading) return;

    const userMsg: Message = {
      id: 'u-' + Date.now(),
      sender: 'user',
      text: prompt.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    const currentPrompt = prompt;
    setPrompt('');
    setLoading(true);

    try {
      // Intelligent AI response simulation / server route endpoint
      setTimeout(() => {
        let reply = "Voici une analyse rapide basée sur vos critères d'agence NovaSphere :\n\n";
        if (currentPrompt.toLowerCase().includes('prêt') || currentPrompt.toLowerCase().includes('taux')) {
          reply += "• Taux moyen actuel sur 20 ans : 3.45% à 3.65%.\n• Capacité d'endettement maximale recommandée : 35% avec reste à vivre suffisant.\n• Conseil : Pensez à proposer la délégation d'assurance pour réduire la mensualité globale.";
        } else if (currentPrompt.toLowerCase().includes('annonce') || currentPrompt.toLowerCase().includes('immo')) {
          reply += "• Superbe appartement haussmannien entièrement rénové au cœur de Paris.\n• Lumineux, parquet point de Hongrie, moulures et cheminées d'époque.\n• Proche de toutes commodités et transports.";
        } else {
          reply += `En réponse à votre demande "${currentPrompt}" : Le dossier répond à la charte d'analyse financière Conseils Finances. Tout est conforme pour présentation en comité bancaire.`;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: 'ai-' + Date.now(),
            sender: 'ai',
            text: reply,
          },
        ]);
        setLoading(false);
      }, 800);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 text-orange-400 flex items-center justify-center font-bold">
          <Zap className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Assistant IA NovaSphere</h1>
          <p className="text-xs text-gray-400">Génération de synthèses, calculs d'endettement et rédaction d'annonces</p>
        </div>
      </div>

      <div className="h-[550px] bg-white/5 border border-white/10 rounded-2xl flex flex-col justify-between p-4 bg-black/20">
        <div className="space-y-4 overflow-y-auto pr-2 custom-scrollbar flex-1">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-3 max-w-2xl ${m.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                  m.sender === 'user'
                    ? 'bg-[#E5B842] text-black'
                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                }`}
              >
                {m.sender === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div
                className={`p-4 rounded-2xl text-xs leading-relaxed whitespace-pre-line ${
                  m.sender === 'user'
                    ? 'bg-[#E5B842] text-black font-semibold'
                    : 'bg-white/10 text-gray-200 border border-white/10'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-orange-400 animate-pulse">
              <Sparkles className="w-4 h-4" />
              <span>Génération de la synthèse IA en cours...</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSend} className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2">
          <input
            type="text"
            placeholder="Posez une question ou demandez une synthèse..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-[#E5B842]"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-[#E5B842] hover:bg-[#d9ab38] text-black p-2.5 rounded-xl font-bold flex items-center justify-center shadow-md disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
export default AssistantIAView;
