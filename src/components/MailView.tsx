import React, { useState } from 'react';
import { Mail, Star, Inbox, Send, Edit, Search } from 'lucide-react';
import { MailItem } from '@/types';

const INITIAL_MAILS: MailItem[] = [];

export const MailView: React.FC = () => {
  const [mails, setMails] = useState<MailItem[]>(INITIAL_MAILS);
  const [selectedMail, setSelectedMail] = useState<MailItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 text-white">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center font-bold">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Messagerie Mail CRM</h1>
            <p className="text-xs text-gray-400">Échanges banques, notaires et clients</p>
          </div>
        </div>

        <button className="bg-[#E5B842] hover:bg-[#d9ab38] text-black font-semibold text-xs px-4 py-2 rounded-xl flex items-center gap-2">
          <Edit className="w-4 h-4" />
          <span>Nouveau message</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px] bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        {/* Mail List */}
        <div className="p-4 bg-black/20 border-r border-white/10 flex flex-col space-y-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Rechercher un courriel..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 bg-white/5 border border-white/10 rounded-xl p-2 text-xs text-white focus:outline-none"
            />
          </div>

          <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
            {mails.map((m) => (
              <div
                key={m.id}
                onClick={() => setSelectedMail(m)}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  selectedMail?.id === m.id
                    ? 'bg-[#E5B842]/20 border-[#E5B842]/40 text-white'
                    : 'bg-white/5 border-white/5 hover:border-white/10 text-gray-300'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-xs text-white truncate">{m.senderName}</span>
                  <span className="text-[10px] text-gray-400">{m.date}</span>
                </div>
                <p className="text-xs font-medium text-amber-400 truncate mb-1">{m.subject}</p>
                <p className="text-[11px] text-gray-400 line-clamp-1">{m.preview}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Selected Mail Details */}
        <div className="md:col-span-2 p-6 bg-black/10 flex flex-col justify-between">
          {selectedMail ? (
            <div>
              <div className="pb-4 border-b border-white/10 mb-4">
                <span className="text-xs bg-blue-500/20 text-blue-400 px-2.5 py-0.5 rounded-full font-bold">
                  Reçu
                </span>
                <h2 className="text-lg font-bold text-white mt-2">{selectedMail.subject}</h2>
                <div className="flex items-center justify-between text-xs text-gray-400 mt-2">
                  <div>
                    <span className="text-white font-semibold">{selectedMail.senderName}</span>{' '}
                    <span>&lt;{selectedMail.senderEmail}&gt;</span>
                  </div>
                  <span>{selectedMail.date}</span>
                </div>
              </div>

              <div className="text-xs text-gray-300 whitespace-pre-line leading-relaxed">
                {selectedMail.body}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500 text-xs">
              Sélectionnez un mail dans la liste
            </div>
          )}

          {selectedMail && (
            <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
              <button className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/5 text-gray-300 hover:text-white">
                Répondre
              </button>
              <button className="px-4 py-2 rounded-xl text-xs font-bold bg-[#E5B842] text-black">
                Transférer au client
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default MailView;
