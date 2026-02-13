import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Beaker,
  FileText,
  Link2,
  ListChecks,
  Plus,
  Save,
  Search,
  X,
} from 'lucide-react';
import api from '../../utils/electronAPI';

const TAB_OPTIONS = [
  { id: 'instructions', label: 'Instructions' },
  { id: 'schema', label: 'Schema' },
  { id: 'chats', label: 'Chats' },
  { id: 'documents', label: 'Documents' },
  { id: 'runs', label: 'Runs' },
  { id: 'records', label: 'Records' },
  { id: 'evidence', label: 'Evidence' },
];

const FIELD_TYPES = ['text', 'url', 'number', 'boolean', 'date', 'array'];

const DEFAULT_SOURCE_POLICY = {
  mode: 'discover_broad_verify_official',
  requireOfficial: true,
  rejectDirectoryPages: true,
  rejectSocialProfiles: true,
  officialDomains: [],
};

const DEFAULT_SCHEMA = [
  { key: 'name', label: 'Name', type: 'text', required: true, description: '', extraction_hints: '' },
  { key: 'official_url', label: 'Official URL', type: 'url', required: true, description: '', extraction_hints: '' },
  { key: 'summary', label: 'Summary', type: 'text', required: false, description: '', extraction_hints: '' },
];

function sanitizeKey(input = '', index = 0) {
  const value = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return value || `field_${index + 1}`;
}

export function ResearchPanel({ isOpen, onClose, workspace = 'work' }) {
  const [activeTab, setActiveTab] = useState('instructions');
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectDraft, setProjectDraft] = useState({
    name: '',
    description: '',
    permanent_instructions: '',
    source_policy: { ...DEFAULT_SOURCE_POLICY },
  });
  const [schemaDraft, setSchemaDraft] = useState(DEFAULT_SCHEMA);
  const [runDraft, setRunDraft] = useState({ objective: '', runInstructions: '', workerCount: 4 });
  const [runs, setRuns] = useState([]);
  const [records, setRecords] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [recordDetails, setRecordDetails] = useState(null);
  const [conversationLinks, setConversationLinks] = useState({ linked: [], available: [] });
  const [documentLinks, setDocumentLinks] = useState({ linked: [], available: [] });
  const [notice, setNotice] = useState('');

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const dynamicColumns = useMemo(() => {
    return (selectedProject?.schema || schemaDraft || []).map((field) => field.key);
  }, [selectedProject, schemaDraft]);

  const refreshProjects = async () => {
    const list = await api.research.listProjects(workspace);
    setProjects(Array.isArray(list) ? list : []);
    if (!selectedProjectId && Array.isArray(list) && list.length > 0) {
      setSelectedProjectId(list[0].id);
    }
  };

  const refreshRuns = async (projectId = selectedProjectId) => {
    if (!projectId) return;
    const list = await api.research.listRuns(projectId, 200);
    setRuns(Array.isArray(list) ? list : []);
  };

  const refreshRecords = async (projectId = selectedProjectId) => {
    if (!projectId) return;
    const list = await api.research.listRecords(projectId, null, 2000);
    setRecords(Array.isArray(list) ? list : []);
  };

  const refreshProjectLinks = async (projectId = selectedProjectId) => {
    if (!projectId) return;
    const [conversations, documents] = await Promise.all([
      api.research.listConversations(projectId, workspace),
      api.research.listDocuments(projectId, workspace),
    ]);
    setConversationLinks(conversations || { linked: [], available: [] });
    setDocumentLinks(documents || { linked: [], available: [] });
  };

  const loadProject = async (projectId) => {
    if (!projectId) return;
    const item = await api.research.getProject(projectId);
    if (!item) return;
    setProjectDraft({
      name: item.name || '',
      description: item.description || '',
      permanent_instructions: item.permanent_instructions || '',
      source_policy: item.source_policy || { ...DEFAULT_SOURCE_POLICY },
    });
    setSchemaDraft(Array.isArray(item.schema) && item.schema.length > 0 ? item.schema : DEFAULT_SCHEMA);
    await Promise.all([
      refreshRuns(projectId),
      refreshRecords(projectId),
      refreshProjectLinks(projectId),
    ]);
  };

  useEffect(() => {
    if (!isOpen) return;
    refreshProjects();
    const unsubscribe = api.research.onRunProgress((payload) => {
      setRuns((prev) => {
        const next = [...prev];
        const index = next.findIndex((item) => item.id === payload.id);
        if (index >= 0) next[index] = { ...next[index], ...payload };
        else next.unshift(payload);
        return next;
      });
      if (payload.status === 'completed' || payload.status === 'error') {
        refreshRecords(payload.projectId);
      }
    });
    return () => unsubscribe?.();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !selectedProjectId) return;
    loadProject(selectedProjectId);
  }, [isOpen, selectedProjectId]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetails(null);
      return;
    }
    api.research.getRecord(selectedRecordId).then((result) => setRecordDetails(result || null));
  }, [selectedRecordId]);

  const handleCreateProject = async () => {
    const payload = {
      workspace,
      name: projectDraft.name || 'Research Project',
      description: projectDraft.description || '',
      permanent_instructions: projectDraft.permanent_instructions || '',
      schema: schemaDraft,
      source_policy: projectDraft.source_policy || DEFAULT_SOURCE_POLICY,
    };
    const result = await api.research.createProject(payload);
    if (result?.success) {
      setNotice('Project created.');
      await refreshProjects();
      setSelectedProjectId(result.id);
    } else {
      setNotice(result?.error || 'Failed to create project.');
    }
  };

  const handleSaveProject = async () => {
    if (!selectedProjectId) return handleCreateProject();
    const result = await api.research.updateProject({
      id: selectedProjectId,
      name: projectDraft.name,
      description: projectDraft.description,
      permanent_instructions: projectDraft.permanent_instructions,
      schema: schemaDraft,
      source_policy: projectDraft.source_policy,
    });
    setNotice(result?.success ? 'Project saved.' : (result?.error || 'Failed to save project.'));
    await refreshProjects();
  };

  const handleRunStart = async () => {
    if (!selectedProjectId || !runDraft.objective.trim()) return;
    const result = await api.research.startRun({
      projectId: selectedProjectId,
      objective: runDraft.objective.trim(),
      runInstructions: runDraft.runInstructions.trim(),
      workerCount: Number(runDraft.workerCount || 4),
    });
    if (result?.success) {
      setNotice('Run started.');
      setSelectedRunId(result.run?.id || null);
      await refreshRuns();
    } else {
      setNotice(result?.error || 'Failed to start run.');
    }
  };

  const toggleConversationLink = async (conversation) => {
    if (!selectedProjectId || !conversation?.id) return;
    const isLinked = Boolean(conversation.linked);
    const result = isLinked
      ? await api.research.unlinkConversation(selectedProjectId, conversation.id)
      : await api.research.linkConversation(selectedProjectId, conversation.id);
    if (!result?.success) setNotice(result?.error || 'Failed to update conversation link.');
    await refreshProjectLinks();
  };

  const toggleDocumentLink = async (doc) => {
    if (!selectedProjectId || !doc?.id) return;
    const isLinked = Boolean(doc.linked);
    const result = isLinked
      ? await api.research.unlinkDocument(selectedProjectId, doc.id)
      : await api.research.linkDocument(selectedProjectId, doc.id);
    if (!result?.success) setNotice(result?.error || 'Failed to update document link.');
    await refreshProjectLinks();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
        <motion.div initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.98, opacity: 0 }} className="w-full max-w-6xl h-[86vh] bg-forge-surface border border-forge-border rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-forge-border flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-workspace-work/20"><Beaker size={17} className="text-workspace-work" /></div>
              <div>
                <h2 className="text-sm font-semibold text-text-primary">Research Panel</h2>
                <p className="text-xs text-text-muted">Project-scoped multi-agent research with official-source validation</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-2 rounded-lg text-text-muted hover:text-text-secondary hover:bg-forge-hover"><X size={16} /></button>
          </div>

          <div className="flex flex-1 min-h-0">
            <div className="w-72 border-r border-forge-border p-3 overflow-y-auto">
              <button type="button" onClick={() => { setSelectedProjectId(null); setProjectDraft({ name: '', description: '', permanent_instructions: '', source_policy: { ...DEFAULT_SOURCE_POLICY } }); setSchemaDraft(DEFAULT_SCHEMA); }} className="w-full mb-3 text-xs px-3 py-2 rounded-lg border border-forge-border hover:bg-forge-hover flex items-center justify-center gap-2"><Plus size={12} />New Project</button>
              <div className="space-y-1">
                {projects.map((project) => (
                  <button key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)} className={`w-full text-left px-3 py-2 rounded-lg border text-xs ${selectedProjectId === project.id ? 'border-workspace-work/40 bg-workspace-work/10 text-text-primary' : 'border-transparent hover:bg-forge-hover text-text-muted'}`}>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-[10px] opacity-70 line-clamp-2">{project.description || 'No description'}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              <div className="border-b border-forge-border px-3 py-2 flex items-center gap-2 overflow-x-auto">
                {TAB_OPTIONS.map((tab) => (
                  <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`text-xs px-3 py-1.5 rounded-md whitespace-nowrap ${activeTab === tab.id ? 'bg-forge-hover text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>{tab.label}</button>
                ))}
              </div>

              {notice ? <div className="px-4 py-2 text-xs text-workspace-work border-b border-forge-border">{notice}</div> : null}

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {activeTab === 'instructions' && (
                  <div className="space-y-3">
                    <input value={projectDraft.name} onChange={(e) => setProjectDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Project name" className="input text-sm" />
                    <textarea value={projectDraft.description} onChange={(e) => setProjectDraft((prev) => ({ ...prev, description: e.target.value }))} placeholder="Project description" className="input text-sm min-h-[70px]" />
                    <textarea value={projectDraft.permanent_instructions} onChange={(e) => setProjectDraft((prev) => ({ ...prev, permanent_instructions: e.target.value }))} placeholder="Permanent instructions for every run" className="input text-sm min-h-[140px]" />
                    <input value={(projectDraft.source_policy?.officialDomains || []).join(', ')} onChange={(e) => setProjectDraft((prev) => ({ ...prev, source_policy: { ...(prev.source_policy || DEFAULT_SOURCE_POLICY), officialDomains: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) } }))} placeholder="Optional official domain allowlist (comma-separated)" className="input text-sm" />
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSaveProject} className="btn btn-primary text-xs flex items-center gap-1"><Save size={12} />Save Project</button>
                      {selectedProjectId && <button type="button" onClick={async () => { await api.research.deleteProject(selectedProjectId); setSelectedProjectId(null); setNotice('Project deleted.'); refreshProjects(); }} className="btn text-xs border border-forge-border">Delete</button>}
                    </div>
                  </div>
                )}

                {activeTab === 'schema' && (
                  <div className="space-y-2">
                    <button type="button" onClick={() => setSchemaDraft((prev) => [...prev, { key: `field_${prev.length + 1}`, label: 'New Field', type: 'text', required: false, description: '', extraction_hints: '' }])} className="btn text-xs border border-forge-border flex items-center gap-1"><Plus size={12} />Add Field</button>
                    {schemaDraft.map((field, index) => (
                      <div key={`${field.key}-${index}`} className="grid grid-cols-12 gap-2 items-center border border-forge-border rounded-lg p-2">
                        <input className="input text-xs col-span-2" value={field.key} onChange={(e) => setSchemaDraft((prev) => prev.map((item, i) => i === index ? { ...item, key: sanitizeKey(e.target.value, index) } : item))} />
                        <input className="input text-xs col-span-2" value={field.label} onChange={(e) => setSchemaDraft((prev) => prev.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} />
                        <select className="input text-xs col-span-2" value={field.type} onChange={(e) => setSchemaDraft((prev) => prev.map((item, i) => i === index ? { ...item, type: e.target.value } : item))}>{FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                        <label className="text-xs col-span-1 flex items-center gap-1"><input type="checkbox" checked={Boolean(field.required)} onChange={(e) => setSchemaDraft((prev) => prev.map((item, i) => i === index ? { ...item, required: e.target.checked } : item))} />Req</label>
                        <input className="input text-xs col-span-3" value={field.extraction_hints || ''} placeholder="Extraction hints" onChange={(e) => setSchemaDraft((prev) => prev.map((item, i) => i === index ? { ...item, extraction_hints: e.target.value } : item))} />
                        <button type="button" className="text-xs col-span-2 px-2 py-1 rounded border border-forge-border hover:bg-forge-hover" onClick={() => setSchemaDraft((prev) => prev.filter((_, i) => i !== index))}>Remove</button>
                      </div>
                    ))}
                    <button type="button" onClick={handleSaveProject} className="btn btn-primary text-xs">Save Schema</button>
                  </div>
                )}

                {activeTab === 'chats' && (
                  <div className="space-y-2">
                    {(conversationLinks.available || []).map((conversation) => (
                      <button key={conversation.id} type="button" onClick={() => toggleConversationLink(conversation)} className={`w-full text-left border rounded-lg px-3 py-2 text-xs ${conversation.linked ? 'border-workspace-work/40 bg-workspace-work/10' : 'border-forge-border hover:bg-forge-hover'}`}>
                        <div className="flex items-center gap-2"><Link2 size={12} />{conversation.title || conversation.id}</div>
                        <div className="text-[10px] text-text-muted mt-1 line-clamp-2">{conversation.preview || 'No preview'}</div>
                      </button>
                    ))}
                  </div>
                )}

                {activeTab === 'documents' && (
                  <div className="space-y-2">
                    {(documentLinks.available || []).map((doc) => (
                      <button key={doc.id} type="button" onClick={() => toggleDocumentLink(doc)} className={`w-full text-left border rounded-lg px-3 py-2 text-xs ${doc.linked ? 'border-workspace-work/40 bg-workspace-work/10' : 'border-forge-border hover:bg-forge-hover'}`}>
                        <div className="flex items-center gap-2"><FileText size={12} />{doc.filename}</div>
                      </button>
                    ))}
                  </div>
                )}

                {activeTab === 'runs' && (
                  <div className="space-y-3">
                    <textarea value={runDraft.objective} onChange={(e) => setRunDraft((prev) => ({ ...prev, objective: e.target.value }))} placeholder="Research objective" className="input min-h-[100px] text-sm" />
                    <textarea value={runDraft.runInstructions} onChange={(e) => setRunDraft((prev) => ({ ...prev, runInstructions: e.target.value }))} placeholder="Per-run override instructions" className="input min-h-[80px] text-sm" />
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={12} value={runDraft.workerCount} onChange={(e) => setRunDraft((prev) => ({ ...prev, workerCount: Number(e.target.value || 4) }))} className="input w-24 text-sm" />
                      <button type="button" onClick={handleRunStart} className="btn btn-primary text-xs flex items-center gap-1"><Search size={12} />Start Run</button>
                      {selectedRunId && <button type="button" onClick={async () => { await api.research.pauseRun(selectedRunId); refreshRuns(); }} className="btn text-xs border border-forge-border">Pause</button>}
                      {selectedRunId && <button type="button" onClick={async () => { await api.research.resumeRun(selectedRunId); refreshRuns(); }} className="btn text-xs border border-forge-border">Resume</button>}
                      {selectedRunId && <button type="button" onClick={async () => { await api.research.cancelRun(selectedRunId); refreshRuns(); }} className="btn text-xs border border-forge-border">Cancel</button>}
                    </div>
                    <div className="space-y-2">
                      {runs.map((run) => (
                        <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)} className={`w-full text-left border rounded-lg px-3 py-2 text-xs ${selectedRunId === run.id ? 'border-workspace-work/40 bg-workspace-work/10' : 'border-forge-border hover:bg-forge-hover'}`}>
                          <div className="flex items-center justify-between"><span>{run.objective}</span><span className="uppercase text-[10px]">{run.status}</span></div>
                          <div className="text-[10px] text-text-muted mt-1">saved {run.stats?.verifiedSaved || 0} | blocked {run.stats?.rejectedBlocked || 0} | queue {run.queueSize || 0} | convergence {run.convergenceCount || 0}/5</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'records' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <button type="button" className="btn text-xs border border-forge-border flex items-center gap-1" onClick={() => api.research.exportRecords({ projectId: selectedProjectId, format: 'json' })}><ListChecks size={12} />Export JSON</button>
                      <button type="button" className="btn text-xs border border-forge-border" onClick={() => api.research.exportRecords({ projectId: selectedProjectId, format: 'csv' })}>Export CSV</button>
                    </div>
                    <div className="border border-forge-border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-forge-hover">
                          <tr>
                            {dynamicColumns.map((col) => <th key={col} className="text-left px-2 py-1">{col}</th>)}
                            <th className="text-left px-2 py-1">evidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {records.map((row) => (
                            <tr key={row.id} className="border-t border-forge-border hover:bg-forge-hover cursor-pointer" onClick={() => { setSelectedRecordId(row.id); setActiveTab('evidence'); }}>
                              {dynamicColumns.map((col) => <td key={`${row.id}-${col}`} className="px-2 py-1">{Array.isArray(row.record?.[col]) ? row.record[col].join(', ') : String(row.record?.[col] ?? '')}</td>)}
                              <td className="px-2 py-1">{row.evidence_count || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'evidence' && (
                  <div className="space-y-2">
                    {!recordDetails && <div className="text-xs text-text-muted">Select a record from the Records tab.</div>}
                    {recordDetails && (
                      <>
                        <div className="text-xs text-text-primary">Record: {recordDetails.record?.name || recordDetails.canonical_key}</div>
                        <div className="space-y-2">
                          {(recordDetails.evidence || []).map((item) => (
                            <div key={item.id} className="border border-forge-border rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">{item.field_key}</span>
                                <span className={item.is_official ? 'text-emerald-400' : 'text-amber-400'}>{item.is_official ? 'official' : 'unverified'}</span>
                              </div>
                              <div className="mt-1 text-text-muted">{item.claim_text}</div>
                              <div className="mt-1 text-[10px] text-text-muted">{item.source_url}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default ResearchPanel;
