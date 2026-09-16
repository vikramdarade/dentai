import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  X,
  FileText,
  ShieldCheck,
  Stethoscope,
  Volume2,
  RefreshCw,
  HelpCircle,
  Copy,
  Check
} from 'lucide-react';

export interface ConciergeMessage {
  id: string;
  sender: 'user' | 'concierge';
  text: string;
  category?: 'pms_workflow' | 'ada_code' | 'ahpra_compliance' | 'audio_hardware' | 'general';
  timestamp: string;
}

export interface ClinicalAiConciergeProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string;
  currentScreenContext?: string;
}

export default function ClinicalAiConcierge({
  isOpen,
  onClose,
  token,
  currentScreenContext
}: ClinicalAiConciergeProps) {
  const [messages, setMessages] = useState<ConciergeMessage[]>([
    {
      id: 'welcome-1',
      sender: 'concierge',
      text: `G'day Doctor! I am your DentAI Clinical Concierge.\n\nI can resolve ADA billing codes, AHPRA record compliance rules, PMS clipboard pasting steps, or operatory audio questions in seconds with zero hold time.`,
      category: 'general',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputText;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: ConciergeMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!queryText) setInputText('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/support/concierge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          query: textToSend.trim(),
          context: { screen: currentScreenContext || 'surgery_cockpit' }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const botMsg: ConciergeMessage = {
          id: `bot_${Date.now()}`,
          sender: 'concierge',
          text: data.answer,
          category: data.category,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, botMsg]);
      } else {
        throw new Error('Support concierge failed to reply.');
      }
    } catch (err) {
      const errorMsg: ConciergeMessage = {
        id: `err_${Date.now()}`,
        sender: 'concierge',
        text: 'I am temporarily unable to reach the cloud knowledge fabric. You can still paste clinical notes directly via F12 or check the Audio Diagnostic modal.',
        category: 'general',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-[110] w-full max-w-md bg-white border-l border-slate-200/90 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/90 backdrop-blur-sm">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-50 border border-cyan-200 flex items-center justify-center text-cyan-700">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-slate-900">Clinical AI Concierge</h3>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                ADA / AHPRA
              </span>
            </div>
            <p className="text-[11px] text-slate-500">Instant chairside clinical &amp; PMS answers</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Suggested Quick Question Chips */}
      <div className="px-4 py-2.5 border-b border-slate-200/80 bg-slate-50 flex items-center gap-1.5 overflow-x-auto no-scrollbar text-[11px]">
        <button
          type="button"
          onClick={() => handleSendMessage('How do I paste into Dental4Windows or EXACT?')}
          className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition flex items-center gap-1 shadow-2xs cursor-pointer"
        >
          <FileText className="w-3 h-3 text-emerald-600" />
          Paste into D4W (F12)
        </button>
        <button
          type="button"
          onClick={() => handleSendMessage('What is the ADA code for 3-surface molar composite?')}
          className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition flex items-center gap-1 shadow-2xs cursor-pointer"
        >
          <Stethoscope className="w-3 h-3 text-indigo-600" />
          ADA 533 Code
        </button>
        <button
          type="button"
          onClick={() => handleSendMessage('What are AHPRA tooth numbering compliance rules?')}
          className="whitespace-nowrap px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition flex items-center gap-1 shadow-2xs cursor-pointer"
        >
          <ShieldCheck className="w-3 h-3 text-amber-600" />
          AHPRA FDI Rules
        </button>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.map((m) => {
          const isUser = m.sender === 'user';
          return (
            <div
              key={m.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`relative max-w-[88%] rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                  isUser
                    ? 'bg-[#0071E3] text-white rounded-br-none shadow-xs'
                    : 'bg-white text-slate-900 border border-slate-200/90 rounded-bl-none shadow-xs'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center justify-between gap-2 mb-1.5 pb-1 border-b border-slate-100 text-[10px] text-slate-500">
                    <span className="font-semibold text-cyan-700 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-cyan-600" />
                      DentAI Clinical Assistant
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(m.id, m.text)}
                      className="hover:text-slate-800 transition flex items-center gap-0.5 cursor-pointer"
                    >
                      {copiedId === m.id ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                )}
                <div className="whitespace-pre-wrap font-sans">{m.text}</div>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 px-1">{m.timestamp}</span>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-white rounded-xl px-3 py-2 w-fit border border-slate-200 shadow-2xs">
            <RefreshCw className="w-3 h-3 animate-spin text-cyan-600" />
            <span>Consulting dental knowledge fabric...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Box Footer */}
      <div className="p-3 border-t border-slate-200 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendMessage();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask ADA codes, AHPRA rules, or PMS shortcuts..."
            disabled={isLoading}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0071E3] focus:bg-white transition"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="bg-[#0071E3] hover:bg-[#0062C4] disabled:opacity-40 text-white rounded-xl p-2.5 transition active:scale-95 shadow-xs cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-slate-400 text-center mt-2 font-mono">
          Autonomous Clinical AI • Certified with AHPRA Dental Board &amp; ADA Schedule
        </p>
      </div>

    </div>
  );
}
