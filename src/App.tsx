/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Play, CheckCircle2, XCircle, MapPin, Globe,
  Mail, Settings, ChevronRight, Copy, Check
} from 'lucide-react';
import { US_CITIES, NICHES } from './lib/constants';
import { cn } from './lib/utils';

type Lead = {
  id: string;
  name: string;
  website: string;
  address: string;
  status: 'pending' | 'extracting' | 'capturing' | 'auditing' | 'drafting' | 'completed' | 'error';
  foundEmail?: string | null;
  auditScore?: number;
  auditDetail?: string;
  coldEmail?: string;
};

export default function App() {
  const [selectedCity, setSelectedCity] = useState(US_CITIES[0].city);
  const [selectedState, setSelectedState] = useState(US_CITIES[0].state);
  const [selectedNiche, setSelectedNiche] = useState(NICHES[0].id);
  
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>('');
  
  const [errorMsg, setErrorMsg] = useState('');

  // Update readonly state based on selected city
  useEffect(() => {
    const cityData = US_CITIES.find(c => c.city === selectedCity);
    if (cityData) {
      setSelectedState(cityData.state);
    }
  }, [selectedCity]);

  const handleSearch = async () => {
    setIsSearching(true);
    setLeads([]);
    setErrorMsg('');
    setCurrentStep('Scraping...');
    
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: selectedCity,
          state: selectedState,
          niche: selectedNiche,
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to search');
      
      const mappedLeads: Lead[] = data.leads.map((l: any) => ({
        ...l,
        status: 'pending'
      }));
      
      setLeads(mappedLeads);
      setCurrentStep(`Found ${mappedLeads.length} leads.`);
    } catch (err: any) {
      setErrorMsg(err.message);
      setCurrentStep('');
    } finally {
      setIsSearching(false);
    }
  };

  const processLead = async (leadIndex: number) => {
    // 1. Extract Email
    updateLead(leadIndex, { status: 'extracting' });
    setCurrentStep('Extracting Contact Info...');
    
    let foundEmail = null;
    try {
      const emailRes = await fetch('/api/scrape-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: leads[leadIndex].website })
      });
      if (emailRes.ok) {
        const body = await emailRes.json();
        foundEmail = body.email;
      }
    } catch (e) {
      // safe fallback
    }
    
    updateLead(leadIndex, { foundEmail, status: 'capturing' });
    setCurrentStep('Capturing Screenshots...');
    
    // 2. Audit & Draft (done by Gemini together)
    updateLead(leadIndex, { status: 'auditing' });
    setCurrentStep('Auditing & Drafting...');
    
    try {
      const auditRes = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: leads[leadIndex].website })
      });
      const auditData = await auditRes.json();
      if (!auditRes.ok) throw new Error(auditData.error || 'Audit failed');
      
      updateLead(leadIndex, {
        status: 'completed',
        auditScore: auditData.auditScore,
        auditDetail: auditData.auditDetail,
        coldEmail: auditData.coldEmail,
      });
    } catch (err) {
      updateLead(leadIndex, { status: 'error' });
    }
  };

  const startPipeline = async () => {
    if (leads.length === 0) return;
    setIsProcessing(true);
    setErrorMsg('');
    
    for (let i = 0; i < leads.length; i++) {
        if (leads[i].status === 'pending') {
            await processLead(i);
        }
    }
    
    setCurrentStep('Pipeline Finished');
    setIsProcessing(false);
  };

  const updateLead = (index: number, updates: Partial<Lead>) => {
    setLeads(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200 pb-20">
      
      {/* Header */}
      <header className="border-b border-white/5 bg-slate-900/50 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-500 text-white rounded p-1.5 flex items-center justify-center">
              <MapPin size={20} strokeWidth={2.5} />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">ProspectPilot</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar: Controls */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-800 rounded-xl p-6 border border-white/5 shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent pointer-events-none" />
            
            <h2 className="text-lg font-medium text-slate-100 mb-4 flex items-center gap-2">
              <Search size={18} className="text-indigo-400" />
              Search Leads
            </h2>
            
            <div className="space-y-4 relative">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">City</label>
                <select 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                  value={selectedCity}
                  onChange={e => setSelectedCity(e.target.value)}
                  disabled={isSearching || isProcessing}
                >
                  {US_CITIES.map(c => (
                    <option key={c.city} value={c.city}>{c.city}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">State</label>
                <input 
                  type="text"
                  readOnly
                  disabled
                  value={selectedState}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-400 cursor-not-allowed opacity-70"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Niche</label>
                <select 
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all appearance-none"
                  value={selectedNiche}
                  onChange={e => setSelectedNiche(e.target.value)}
                  disabled={isSearching || isProcessing}
                >
                  {NICHES.map(n => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
              </div>

              <button 
                onClick={handleSearch}
                disabled={isSearching || isProcessing}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2 mt-4"
              >
                {isSearching ? (
                  <div className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                ) : (
                  <Search size={16} />
                )}
                Find Leads
              </button>
            </div>
          </div>

          {(leads.length > 0) && (
             <div className="bg-slate-800 rounded-xl p-6 border border-white/5 shadow-xl">
               <h3 className="text-sm font-medium text-slate-200 mb-2">Processing Pipeline</h3>
               <div className="flex items-center justify-between text-xs text-slate-400 mb-4 bg-slate-900 rounded p-3">
                 <span className="truncate mr-2">Status: {currentStep || 'Idle'}</span>
                 {isProcessing && <div className="h-3 w-3 rounded-full bg-indigo-500 animate-pulse shrink-0" />}
               </div>
               
               <button
                 onClick={startPipeline}
                 disabled={isProcessing || isSearching}
                 className="w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg py-2.5 transition-colors flex items-center justify-center gap-2"
               >
                 <Play size={16} className={cn(isProcessing && "opacity-50")} />
                 {isProcessing ? 'Processing Sequentially...' : 'Start Pipeline'}
               </button>
             </div>
          )}

          {errorMsg && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-4 rounded-lg flex gap-3 items-start">
              <XCircle size={18} className="shrink-0 mt-0.5" />
              <p>{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Right Content: Feed */}
        <div className="lg:col-span-8">
          <div className="flex flex-col gap-4">
            <AnimatePresence>
              {leads.map((lead, index) => (
                <motion.div
                  key={lead.id}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(index * 0.1, 1) }}
                >
                  <LeadCard lead={lead} onProcess={() => processLead(index)} isProcessingApp={isProcessing} />
                </motion.div>
              ))}
            </AnimatePresence>
            
            {leads.length === 0 && !isSearching && (
              <div className="h-[40vh] flex flex-col items-center justify-center text-slate-500 border border-dashed border-slate-700/50 rounded-xl bg-slate-800/30">
                <Globe size={48} strokeWidth={1} className="mb-4 opacity-50" />
                <p>Run a search to populate leads</p>
              </div>
            )}
            {leads.length === 0 && isSearching && (
               <div className="h-[40vh] flex flex-col items-center justify-center text-slate-400">
                 <div className="h-8 w-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin mb-4" />
                 <p>Scraping local businesses...</p>
               </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

function LeadCard({ lead, onProcess, isProcessingApp }: { lead: Lead, onProcess: () => void, isProcessingApp: boolean }) {
  const [activeTab, setActiveTab] = useState<'audit' | 'email'>('audit');
  
  // Local state for the editable email field
  const [manualEmail, setManualEmail] = useState('');
  
  // Re-populate if foundEmail exists and manualEmail is empty
  useEffect(() => {
    if (lead.foundEmail && !manualEmail) {
      setManualEmail(lead.foundEmail);
    }
  }, [lead.foundEmail, manualEmail]);

  const [copied, setCopied] = useState(false);
  const copyEmail = () => {
    if (lead.foundEmail) {
      navigator.clipboard.writeText(lead.foundEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isBusy = ['extracting', 'capturing', 'auditing', 'drafting'].includes(lead.status);

  return (
    <div className="bg-slate-800 rounded-xl border border-white/5 shadow-md overflow-hidden flex flex-col text-sm transition-all hover:border-slate-600/50">
      {/* Card Header & Compact Info */}
      <div className="p-5 flex items-start gap-4 flex-col sm:flex-row">
        
        <div className="flex-1">
          <div className="flex items-start justify-between mb-1">
             <h3 className="text-base font-semibold text-white">{lead.name}</h3>
             
             {/* Score Badge */}
             {lead.auditScore !== undefined && (
               <div className={cn(
                 "px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1",
                 lead.auditScore > 75 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                 lead.auditScore >= 50 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                 "bg-rose-500/10 text-rose-400 border-rose-500/20"
               )}>
                 Score: {lead.auditScore}
               </div>
             )}
          </div>

          <div className="text-slate-400 text-xs flex flex-col gap-1.5 mt-2">
            <div className="flex items-center gap-1.5 truncate">
               <Globe size={14} className="shrink-0" />
               <a href={lead.website} target="_blank" rel="noreferrer" className="hover:text-indigo-400 hover:underline truncate">{lead.website}</a>
            </div>
            <div className="flex items-center gap-1.5 truncate">
               <MapPin size={14} className="shrink-0" />
               <span className="truncate">{lead.address}</span>
            </div>
            
            {/* Email extracted status */}
            <div className="flex items-center gap-1.5 mt-1 border-t border-slate-700 pt-2">
              <Mail size={14} className="shrink-0 text-slate-500" />
              {lead.foundEmail ? (
                <>
                  <span className="text-emerald-400 truncate">{lead.foundEmail}</span>
                  <button onClick={copyEmail} className="p-1 hover:bg-slate-700 rounded text-slate-400 transition ml-1" title="Copy">
                     {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </>
              ) : lead.status === 'completed' ? (
                <span className="text-amber-500/80 italic">Email needed</span>
              ) : (
                <span className="text-slate-500">Not extracted</span>
              )}
            </div>
          </div>
        </div>

        {/* Action button if pending */}
        <div className="sm:self-center shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
          {lead.status === 'pending' || lead.status === 'error' ? (
             <button 
               onClick={onProcess}
               disabled={isProcessingApp}
               className="w-full sm:w-auto bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-xs px-4 py-2 rounded-md transition"
             >
               {lead.status === 'error' ? 'Retry Process' : 'Process'}
             </button>
          ) : lead.status === 'completed' ? (
             <div className="text-emerald-400 flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 bg-emerald-400/10 rounded-full border border-emerald-400/20">
               <CheckCircle2 size={14} /> Done
             </div>
          ) : (
             <div className="flex items-center gap-2 text-indigo-400 text-xs px-3 py-1.5 bg-indigo-400/10 rounded-full border border-indigo-400/20">
               <div className="h-3 w-3 rounded-full border-2 border-indigo-400/30 border-t-indigo-400 animate-spin" />
               <span className="capitalize">{lead.status}...</span>
             </div>
          )}
        </div>
      </div>

      {/* Audit/Draft Details (only shown when completed) */}
      {lead.status === 'completed' && (
        <div className="border-t border-slate-700/50 bg-slate-900/30 flex flex-col">
          <div className="flex border-b border-slate-700/50">
            <button 
              className={cn("flex-1 py-3 text-xs font-medium transition-colors", activeTab === 'audit' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400 hover:text-slate-300")}
              onClick={() => setActiveTab('audit')}
            >
              System Audit
            </button>
            <button 
              className={cn("flex-1 py-3 text-xs font-medium transition-colors", activeTab === 'email' ? "text-indigo-400 border-b-2 border-indigo-500" : "text-slate-400 hover:text-slate-300")}
              onClick={() => setActiveTab('email')}
            >
              Drafted Email
            </button>
          </div>

          <div className="p-5 text-slate-300 leading-relaxed max-h-64 overflow-y-auto custom-scrollbar">
            {activeTab === 'audit' ? (
              <div className="space-y-4">
                <div>
                   <h4 className="text-slate-500 text-[11px] uppercase tracking-wider mb-1">AI Findings</h4>
                   <p className="text-[13px]">{lead.auditDetail}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                 <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-500 uppercase tracking-wider shrink-0 w-16">To:</label>
                    <input 
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      placeholder="Add an email address..."
                    />
                 </div>
                 <div className="flex items-start gap-2">
                    <label className="text-[11px] text-slate-500 uppercase tracking-wider shrink-0 w-16 pt-1.5">Draft:</label>
                    <textarea 
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-h-[100px] resize-y custom-scrollbar"
                      defaultValue={lead.coldEmail}
                    />
                 </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

