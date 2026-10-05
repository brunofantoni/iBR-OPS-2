import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  Shield,
  Database,
  Network,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Users,
  Key,
  RefreshCw,
  Sliders,
  Plus,
  ChevronRight,
  Download,
  Search,
  BookOpen,
  History,
  FileCheck,
  UserCheck,
  Clock,
  Eye,
  Settings,
  HelpCircle,
  FileCode,
  LayoutDashboard
} from 'lucide-react';

// Define TS Types matching backend database entities
interface User {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'TECHNICIAN' | 'VIEWER';
  status: 'ACTIVE' | 'INACTIVE';
}

interface Client {
  id: string;
  name: string;
  code: string;
  domain: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'ACTIVE' | 'INACTIVE';
  sla_hours: number;
  assetCount?: number;
  activeIncidentCount?: number;
}

interface Asset {
  id: string;
  clientId: string;
  datacenter: string;
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  type: string;
  hostname: string;
  displayName: string;
  internalIp: string;
  externalIp: string;
  operatingSystem: string;
  version: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'ACTIVE' | 'INACTIVE' | 'DEGRADED' | 'OFFLINE';
  lastDiscovery: string;
  lastValidation: string;
  clientName?: string;
  clientCode?: string;
  connectionsCount?: number;
}

interface AssetRelationship {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  type: string;
  origin: string;
  status: string;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  clientId?: string;
  environment?: string;
  type: 'GLOBAL' | 'CLIENT' | 'TECHNOLOGY' | 'RUNBOOK' | 'INCIDENT' | 'POLICY' | 'ARCHITECTURE' | 'HISTORICAL';
  category: string;
  criticality: string;
  tags: string[];
  status: 'DRAFT' | 'VERIFIED' | 'CANONICAL' | 'SUPERSEDED' | 'ARCHIVED';
  content: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  version: number;
}

interface KnowledgeConflict {
  id: string;
  documentId: string;
  fieldName: string;
  documentedValue: string;
  documentedOrigin: string;
  observedValue: string;
  observedOrigin: string;
  observedAt: string;
  status: 'OPEN' | 'RESOLVED' | 'IGNORED';
}

interface RepositoryFile {
  id: string;
  fileName: string;
  fileSize: number;
  category: string;
  status: 'PENDING' | 'PROCESSED' | 'ERROR';
  content: string;
  uploadedAt: string;
  autoExtractedMetadata?: {
    clients: string[];
    assets: Partial<Asset>[];
    ips: string[];
    relationships: Partial<AssetRelationship>[];
    secretsFound: boolean;
  };
}

interface Incident {
  id: string;
  clientId: string;
  assetId?: string;
  title: string;
  description: string;
  status: 'NEW' | 'TRIAGE' | 'COLLECTING_DIAGNOSTICS' | 'DIAGNOSED' | 'SOLUTION_PROPOSED' | 'WAITING_APPROVAL' | 'EXECUTING' | 'VALIDATING' | 'RESOLVED' | 'ESCALATED' | 'CLOSED';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: string;
  updatedAt: string;
  clientName?: string;
  clientCode?: string;
  assetHostname?: string;
}

interface IncidentMessage {
  id: string;
  incidentId: string;
  sender: 'IA_AGENT' | 'TECHNICIAN' | 'ADMIN' | 'SYSTEM';
  senderName: string;
  message: string;
  createdAt: string;
}

interface AuditLog {
  id: string;
  userId: string;
  username: string;
  clientId?: string;
  incidentId?: string;
  action: string;
  details: string;
  toolUsed?: string;
  riskLevel: number;
  aiModelUsed?: string;
  tokensUsed?: number;
  costEstimated?: number;
  latencyMs?: number;
  timestamp: string;
}

interface DiagnosticRun {
  id: string;
  incidentId: string;
  assetId: string;
  toolName: string;
  commandExecuted: string;
  riskLevel: number;
  stdout: string;
  status: 'SUCCESS' | 'FAILED';
  executedBy: string;
  timestamp: string;
}

export default function App() {
  // Navigation Menu Tabs
  const [activeTab, setActiveTab] = useState<'dashboard' | 'operations' | 'repos' | 'kb' | 'clients' | 'audit'>('operations');

  // Multi-User Profile Mock RBAC State
  const [currentUser, setCurrentUser] = useState<User>({ id: '', username: 'loading...', email: '', role: 'VIEWER', status: 'ACTIVE' });

  // Dashboard Stats
  const [stats, setStats] = useState({
    openCount: 0,
    criticalCount: 0,
    totalAssets: 0,
    totalClients: 0,
    mttrHours: 0.0,
    recentAudits: [] as AuditLog[]
  });

  // Main Entity Collections
  const [clients, setClients] = useState<Client[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [relationships, setRelationships] = useState<AssetRelationship[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [kbDocs, setKbDocs] = useState<KnowledgeDocument[]>([]);
  const [kbConflicts, setKbConflicts] = useState<KnowledgeConflict[]>([]);
  const [repoFiles, setRepoFiles] = useState<RepositoryFile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Operational Cockpit State
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [selectedIncidentDetails, setSelectedIncidentDetails] = useState<(Incident & { messages: IncidentMessage[]; diagnostics: DiagnosticRun[]; client?: Client; asset?: Asset }) | null>(null);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [techMessage, setTechMessage] = useState<string>('');
  const [runningDiagnostic, setRunningDiagnostic] = useState<string | null>(null);

  // Repositories File Ingest states
  const [newFileName, setNewFileName] = useState<string>('');
  const [newFileContent, setNewFileContent] = useState<string>('');
  const [newFileCategory, setNewFileCategory] = useState<string>('Caixa de Entrada');
  const [activeIngestFile, setActiveIngestFile] = useState<RepositoryFile | null>(null);

  // KB Filters
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbFilterType, setKbFilterType] = useState<string>('');

  // Selected asset detail side panel state (Operations tab)
  const [selectedAssetDetail, setSelectedAssetDetail] = useState<Asset | null>(null);

  // Auto scroll logic for diagnostic chat window
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Initialization & Polling trigger
  useEffect(() => {
    fetchSession();
    fetchInitialData();
  }, [activeTab]);

  useEffect(() => {
    if (selectedIncidentId) {
      fetchIncidentDetails(selectedIncidentId);
    }
  }, [selectedIncidentId]);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedIncidentDetails?.messages]);

  const fetchSession = async () => {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (data.user) {
        setCurrentUser(data.user);
      }
    } catch (e) {
      console.error('Error fetching session.', e);
    }
  };

  const handleRoleChange = async (role: 'ADMIN' | 'TECHNICIAN' | 'VIEWER') => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json();
      if (data.user) {
        setCurrentUser(data.user);
        // Refresh everything to trigger RBAC constraints update
        fetchInitialData();
        if (selectedIncidentId) {
          fetchIncidentDetails(selectedIncidentId);
        }
      }
    } catch (e) {
      console.error('Error switching profile role.', e);
    }
  };

  const fetchInitialData = async () => {
    try {
      // Fetch Dashboard Stats
      const statsRes = await fetch('/api/dashboard/stats');
      setStats(await statsRes.json());

      // Fetch Clients
      const clientsRes = await fetch('/api/clients');
      const clientsData = await clientsRes.json();
      setClients(clientsData);

      // Fetch Assets
      const assetsRes = await fetch('/api/assets');
      const assetsData = await assetsRes.json();
      setAssets(assetsData);

      // Fetch Relationships
      const relRes = await fetch('/api/relationships');
      setRelationships(await relRes.json());

      // Fetch Incidents
      const incidentsRes = await fetch('/api/incidents');
      const incidentsData = await incidentsRes.json();
      setIncidents(incidentsData);
      
      // Auto-select first incident on mount if none is selected
      if (incidentsData.length > 0 && !selectedIncidentId) {
        setSelectedIncidentId(incidentsData[0].id);
      }

      // Fetch KB
      const kbRes = await fetch(`/api/kb?type=${kbFilterType}&search=${kbSearch}`);
      setKbDocs(await kbRes.json());

      // Fetch KB Conflicts
      const confRes = await fetch('/api/kb/conflicts');
      setKbConflicts(await confRes.json());

      // Fetch Repository Ingest Files
      const reposRes = await fetch('/api/repos');
      setRepoFiles(await reposRes.json());

      // Fetch Audit Logs
      const auditRes = await fetch('/api/audit-logs');
      setAuditLogs(await auditRes.json());
    } catch (e) {
      console.error('Error loading initial databases status.', e);
    }
  };

  const fetchIncidentDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/incidents/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedIncidentDetails(data);
      }
    } catch (e) {
      console.error('Error loading single incident details.', e);
    }
  };

  // Chat message submission
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!techMessage.trim() || !selectedIncidentId) return;

    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: techMessage })
      });
      if (res.ok) {
        setTechMessage('');
        fetchIncidentDetails(selectedIncidentId);
      }
    } catch (e) {
      console.error('Error sending message.', e);
    }
  };

  // AI Context-RAG Assistant Query submission (Section 49, 79)
  const handleAiQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !selectedIncidentId || isAiLoading) return;

    setIsAiLoading(true);
    // Add temporary loading message locally for fluid feedback
    if (selectedIncidentDetails) {
      setSelectedIncidentDetails({
        ...selectedIncidentDetails,
        messages: [
          ...selectedIncidentDetails.messages,
          {
            id: 'temp-loading',
            incidentId: selectedIncidentId,
            sender: 'IA_AGENT',
            senderName: 'IBR Ops AI Engine',
            message: 'Analisando evidências, consultando runbooks no RAG e calculando impactos de topologia...',
            createdAt: new Date().toISOString()
          }
        ]
      });
    }

    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}/ai-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt })
      });
      if (res.ok) {
        setAiPrompt('');
        fetchIncidentDetails(selectedIncidentId);
      }
    } catch (e) {
      console.error('Error executing AI prompt.', e);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Secure structured LEVEL 0 Tool executor (Section 37, 38)
  const executeDiagnosticTool = async (toolName: string, assetId: string) => {
    if (!selectedIncidentId || runningDiagnostic) return;

    // Check RBAC limits (Viewer can not execute commands)
    if (currentUser.role === 'VIEWER') {
      alert('Acesso negado: Visualizadores não possuem autorização para disparar ferramentas de diagnóstico.');
      return;
    }

    setRunningDiagnostic(toolName);
    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, assetId })
      });
      if (res.ok) {
        fetchIncidentDetails(selectedIncidentId);
      }
    } catch (e) {
      console.error('Diagnostic error.', e);
    } finally {
      setRunningDiagnostic(null);
    }
  };

  // Transition Incident Operational Lifecycle states (Section 46)
  const updateIncidentStatus = async (status: Incident['status']) => {
    if (currentUser.role === 'VIEWER') {
      alert('Permissão insuficiente para alterar estados operacionais.');
      return;
    }

    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        fetchIncidentDetails(selectedIncidentId);
        fetchInitialData();
      }
    } catch (e) {
      console.error('Error updating state.', e);
    }
  };

  // Ingest Document upload Simulation
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName || !newFileContent) return;

    try {
      const res = await fetch('/api/repos/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: newFileName,
          content: newFileContent,
          category: newFileCategory
        })
      });
      if (res.ok) {
        const file = await res.json();
        setNewFileName('');
        setNewFileContent('');
        setActiveIngestFile(file);
        fetchInitialData();
      }
    } catch (e) {
      console.error('File intake failure.', e);
    }
  };

  // Confirm recommendations of the parsed file (Promotion to DB)
  const confirmFileIngestion = async (fileId: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Acesso Restrito: Somente administradores (ADMIN) podem promover novos ativos e relacionamentos ao MySQL canônico.');
      return;
    }

    try {
      const res = await fetch(`/api/repos/confirm-ingest/${fileId}`, {
        method: 'POST'
      });
      if (res.ok) {
        setActiveIngestFile(null);
        fetchInitialData();
      }
    } catch (e) {
      console.error('Error committing ingestion.', e);
    }
  };

  // Resolve Knowledge Conflict (Section 20)
  const resolveConflict = async (conflictId: string, action: 'keep' | 'update' | 'reject') => {
    if (currentUser.role !== 'ADMIN') {
      alert('Acesso Restrito: Somente administradores podem reconciliar divergências da KB.');
      return;
    }

    try {
      const res = await fetch(`/api/kb/conflicts/${conflictId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        fetchInitialData();
      }
    } catch (e) {
      console.error('Conflict update failure.', e);
    }
  };

  // Auto pre-populate ingestion test case for easy evaluation (Section 79 scenario)
  const loadExampleIngestDoc = () => {
    setNewFileName('creci_production_topology.md');
    setNewFileContent(`### MAPA DE ATIVOS - CRECI DF
Cliente: CRECI DF
Temos o servidor principal de aplicações APP01 operando no IP 192.168.10.11 com AlmaLinux 9 e Nginx.
Temos também a máquina de banco de dados canônico DB01 no IP 192.168.10.12 com Rocky Linux 9 e MySQL 8.
O APP01 conecta no banco DB01 para querys estruturadas.

#### Informações confidenciais e credenciais (Segredos para teste de Redação):
SSH Root Password: root_password_super_secret_123
API Token pfSense: token_creci_pfsense_998877

Para suporte adicional contatar Bruno Fantoni.`);
    setNewFileCategory('Infraestrutura');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col antialiased selection:bg-cyan-500/30 selection:text-white">
      
      {/* 1. TOP BAR CONTRACT (3 ZONES) */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 shrink-0">
        {/* Zone 1: Brand Title (Single text element wordmark) */}
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            IBR Ops
          </span>
          <span className="text-xs text-slate-500 font-mono select-none">v1.0.0</span>
          <span className="bg-cyan-500/10 text-cyan-400 text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded border border-cyan-500/20">
            SIMULATION MODE
          </span>
        </div>

        {/* Zone 2: Navigation Links (Compact labels, hover states) */}
        <nav className="hidden xl:flex items-center gap-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'dashboard' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('operations')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'operations' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <Activity className="w-4 h-4" />
            Operações Cockpit
          </button>
          <button
            onClick={() => setActiveTab('repos')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'repos' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <Download className="w-4 h-4" />
            Ingestão Repos
          </button>
          <button
            onClick={() => setActiveTab('kb')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'kb' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <BookOpen className="w-4 h-4" />
            Knowledge Base
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'clients' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <Users className="w-4 h-4" />
            Clientes & Ativos
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${activeTab === 'audit' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <Shield className="w-4 h-4" />
            Auditoria
          </button>
        </nav>

        {/* Zone 3: Active Profile RBAC Switcher & Actions */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <span className="text-[11px] font-mono text-slate-500 uppercase px-2">Perfil Ativo:</span>
            <button
              onClick={() => handleRoleChange('VIEWER')}
              className={`px-2 py-1 text-xs font-medium rounded ${currentUser.role === 'VIEWER' ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Viewer
            </button>
            <button
              onClick={() => handleRoleChange('TECHNICIAN')}
              className={`px-2 py-1 text-xs font-medium rounded ${currentUser.role === 'TECHNICIAN' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Tech
            </button>
            <button
              onClick={() => handleRoleChange('ADMIN')}
              className={`px-2 py-1 text-xs font-medium rounded ${currentUser.role === 'ADMIN' ? 'bg-cyan-600/20 text-cyan-400 border border-cyan-500/30' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Admin
            </button>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-xs font-semibold text-slate-300">{currentUser.username}</div>
            <div className="text-[10px] font-mono text-slate-500">{currentUser.email}</div>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER VIEWPORT */}
      <main className="flex-1 overflow-hidden flex flex-col">
        
        {/* VIEW: DASHBOARD PANEL */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl mx-auto w-full">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard Operacional</h1>
                <p className="text-slate-400 text-sm">Monitoramento de SLAs, incidentes críticos e métricas de IA de ponta a ponta.</p>
              </div>
              <button onClick={fetchInitialData} className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700">
                <RefreshCw className="w-3.5 h-3.5" />
                Sincronizar
              </button>
            </div>

            {/* Stat Cards Grid (Zero-Pill and Compact design) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Incidentes em Aberto</div>
                <div className="text-4xl font-extrabold text-white mt-1 font-mono tracking-tight">{stats.openCount}</div>
                <div className="text-[11px] text-slate-500 mt-2">Casos sob investigação ativa dos técnicos</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Severidade Crítica</div>
                <div className="text-4xl font-extrabold text-red-500 mt-1 font-mono tracking-tight">{stats.criticalCount}</div>
                <div className="text-[11px] text-slate-500 mt-2">Casos de alto impacto imediato fora do SLA</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Média de Resolução (MTTR)</div>
                <div className="text-4xl font-extrabold text-white mt-1 font-mono tracking-tight">{stats.mttrHours}h</div>
                <div className="text-[11px] text-slate-500 mt-2">Indicador de eficiência operacional</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Inventário de Ativos</div>
                <div className="text-4xl font-extrabold text-cyan-400 mt-1 font-mono tracking-tight">{stats.totalAssets}</div>
                <div className="text-[11px] text-slate-500 mt-2">VMs, Proxies e Bancos de Dados persistidos</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Clients SLA Health Indicator */}
              <div className="lg:col-span-2 bg-slate-950 p-5 rounded-lg border border-slate-800 flex flex-col h-full justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 font-mono">Volumetria & Acordos de SLA</h3>
                  <div className="space-y-4">
                    {clients.map(c => (
                      <div key={c.id} className="pb-3 border-b border-slate-800/50 flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-slate-200">{c.name}</div>
                          <div className="text-xs text-slate-500">
                            Domínio: {c.domain} · SLA de Resolução: <span className="font-mono text-slate-400">{c.sla_hours} horas</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono font-bold text-white">{c.activeIncidentCount} ativos</div>
                          <span className={`text-[10px] font-mono font-medium ${c.criticality === 'CRITICAL' ? 'text-red-400' : 'text-amber-400'}`}>
                            Risco: {c.criticality}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500">
                  Os limites de conformidade operacional são recalculados a cada transição de status no MySQL.
                </div>
              </div>

              {/* Immutable Security Logs Tracker */}
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 flex flex-col h-full justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 font-mono">Últimas Auditorias de Segurança</h3>
                  <div className="space-y-3">
                    {stats.recentAudits.map(log => (
                      <div key={log.id} className="text-xs pb-3 border-b border-slate-800 last:border-0">
                        <div className="flex items-center justify-between font-mono text-slate-500">
                          <span>{log.username} · {log.action}</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                        </div>
                        <p className="text-slate-300 mt-1">{log.details}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('audit')}
                  className="w-full text-center mt-4 text-xs font-semibold text-cyan-400 hover:text-cyan-300 pt-3 border-t border-slate-800 flex items-center justify-center gap-1"
                >
                  Ver Todos os Registros de Auditoria
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: OPERATIONS WORKBENCH (THE PRIMARY COCKPIT - TRIPLE PANEL) */}
        {activeTab === 'operations' && (
          <div className="flex-1 flex overflow-hidden">
            
            {/* PANEL 1 (LEFT SIDEBAR): CLIENTS PICKER & TOPOLOGY SELECTOR */}
            <div className="w-80 border-r border-slate-800 bg-slate-950/40 flex flex-col shrink-0">
              <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-400">Ativos & Infraestrutura</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">MySQL Local</span>
              </div>

              {/* Incidents Selection Stream */}
              <div className="p-3 border-b border-slate-800">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider font-mono block mb-1">Chamado / Incidente Ativo:</label>
                <select
                  value={selectedIncidentId}
                  onChange={(e) => setSelectedIncidentId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded p-2 focus:border-cyan-500 focus:outline-none"
                >
                  {incidents.map(inc => (
                    <option key={inc.id} value={inc.id}>
                      [{inc.clientCode}] {inc.title.substring(0, 35)}...
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic topology & infrastructure explorer (Grouped by datacenter) */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                
                {/* Datacenter: Canada */}
                <div>
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest px-2 mb-2">Canadá (OVH Proxy Cloud)</div>
                  <div className="space-y-1">
                    {assets.filter(a => a.datacenter.includes('Canadá')).map(a => (
                      <button
                        key={a.id}
                        onClick={() => setSelectedAssetDetail(a)}
                        className={`w-full text-left p-2.5 rounded text-xs flex items-center justify-between transition-colors ${selectedAssetDetail?.id === a.id ? 'bg-slate-800 border-l-2 border-cyan-400' : 'bg-slate-900/40 hover:bg-slate-800/50'}`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-semibold text-slate-200 truncate">{a.hostname}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{a.internalIp} · {a.type}</div>
                        </div>
                        <span className={`h-2 w-2 rounded-full ${a.status === 'ACTIVE' ? 'bg-emerald-500' : a.status === 'DEGRADED' ? 'bg-amber-500' : 'bg-red-500'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Datacenter: Brazil */}
                <div>
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest px-2 mb-2">Brasil (Equinix Proxy Local)</div>
                  <div className="space-y-1">
                    {assets.filter(a => a.datacenter.includes('Brasil')).map(a => (
                      <button
                        key={a.id}
                        onClick={() => setSelectedAssetDetail(a)}
                        className={`w-full text-left p-2.5 rounded text-xs flex items-center justify-between transition-colors ${selectedAssetDetail?.id === a.id ? 'bg-slate-800 border-l-2 border-cyan-400' : 'bg-slate-900/40 hover:bg-slate-800/50'}`}
                      >
                        <div className="truncate pr-2">
                          <div className="font-semibold text-slate-200 truncate">{a.hostname}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{a.internalIp} · {a.type}</div>
                        </div>
                        <span className={`h-2 w-2 rounded-full ${a.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Simulated live VPN Tunnels & Connections indicators */}
                <div className="pt-2 border-t border-slate-850">
                  <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest px-2 mb-2">Túneis IPSec / OpenVPN</div>
                  <div className="p-2.5 bg-slate-950/80 rounded border border-slate-850 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 font-mono font-medium">WEB020 ↔ WEB008</span>
                      <span className="text-emerald-400 font-mono text-[10px]">CONECTADO</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1 font-mono">Túnel IPSec entre Canadá e Brasil ativo</div>
                  </div>
                </div>

              </div>

              {/* Quick Info Block (Section 23 - Static rule validation) */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 text-xs text-slate-500">
                <p className="font-mono text-slate-400">Timezone: America/Sao_Paulo</p>
                <p className="mt-1">Nenhuma alteração direta permitida sem auditoria.</p>
              </div>
            </div>

            {/* PANEL 2 (CENTER): DISCUSSION & LIVE DIAGNOSTICS STREAM */}
            <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
              
              {/* Context header */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase text-slate-500">Operador Logado: {currentUser.username}</span>
                  <h2 className="text-sm font-semibold text-white mt-0.5">
                    {selectedIncidentDetails?.title || 'Selecione um chamado ao lado'}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Modo de Execução:</span>
                  <span className="text-xs font-mono font-bold uppercase text-amber-400">simulation</span>
                </div>
              </div>

              {/* Conversation Log Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                
                {/* Simulated log baseline alert details */}
                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-lg">
                  <div className="flex items-center justify-between font-mono text-xs text-slate-500 mb-1">
                    <span>DESCRIÇÃO DO INCIDENTE ORIGINAL</span>
                    <span>SLA: {selectedIncidentDetails?.client?.sla_hours || 4} horas</span>
                  </div>
                  <p className="text-slate-300 text-xs">{selectedIncidentDetails?.description}</p>
                </div>

                {/* Messages mapped (Technician logs vs IA operational outputs) */}
                {selectedIncidentDetails?.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col max-w-4xl p-3.5 rounded-lg text-xs leading-relaxed ${
                      msg.sender === 'IA_AGENT'
                        ? 'bg-slate-950 border border-cyan-500/20 text-slate-100 self-start mr-8'
                        : msg.sender === 'SYSTEM'
                        ? 'bg-slate-950/50 border border-slate-800 text-slate-400 italic self-center text-center max-w-xl'
                        : 'bg-slate-800/80 text-white self-end ml-8'
                    }`}
                  >
                    <div className="flex items-center justify-between font-mono text-[10px] text-slate-500 mb-1.5 pb-1 border-b border-slate-800/50">
                      <span className="font-bold text-slate-400 uppercase tracking-wide">{msg.senderName}</span>
                      <span>{new Date(msg.createdAt).toLocaleTimeString('pt-BR')}</span>
                    </div>
                    {msg.message.startsWith('[DIAGNOSTIC]') ? (
                      <div className="font-mono whitespace-pre bg-slate-900 p-2.5 rounded text-cyan-400 border border-slate-800 overflow-x-auto">
                        {msg.message}
                      </div>
                    ) : (
                      <div className="whitespace-pre-line prose prose-invert max-w-none text-slate-200">
                        {msg.message}
                      </div>
                    )}
                  </div>
                ))}
                
                <div ref={chatBottomRef} />
              </div>

              {/* BOTTOM PANEL: ACTIONS PANEL AND IA RAG CHAT PROMPT */}
              <div className="p-4 border-t border-slate-850 bg-slate-950/60 space-y-3">
                
                {/* Structured diagnostic quick-launch bar (No raw shell, security strictly enforced!) */}
                {selectedIncidentDetails?.asset && (
                  <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-850">
                    <span className="text-[10px] text-slate-500 uppercase font-mono mr-2">Diagnósticos Disponíveis (LEVEL 0):</span>
                    <button
                      onClick={() => executeDiagnosticTool('checkHttp', selectedIncidentDetails.asset!.id)}
                      disabled={!!runningDiagnostic}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300 transition-colors inline-flex items-center gap-1 hover:border-slate-700"
                    >
                      <TerminalIcon className="w-3 h-3" />
                      Check HTTP (curl)
                    </button>
                    <button
                      onClick={() => executeDiagnosticTool('checkService', selectedIncidentDetails.asset!.id)}
                      disabled={!!runningDiagnostic}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300 transition-colors inline-flex items-center gap-1 hover:border-slate-700"
                    >
                      <TerminalIcon className="w-3 h-3" />
                      Check Nginx Service
                    </button>
                    <button
                      onClick={() => executeDiagnosticTool('checkDisk', selectedIncidentDetails.asset!.id)}
                      disabled={!!runningDiagnostic}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300 transition-colors inline-flex items-center gap-1 hover:border-slate-700"
                    >
                      <TerminalIcon className="w-3 h-3" />
                      Check Disk (df -h)
                    </button>
                    <button
                      onClick={() => executeDiagnosticTool('checkMemory', selectedIncidentDetails.asset!.id)}
                      disabled={!!runningDiagnostic}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300 transition-colors inline-flex items-center gap-1 hover:border-slate-700"
                    >
                      <TerminalIcon className="w-3 h-3" />
                      Check Memory (free -h)
                    </button>
                    <button
                      onClick={() => executeDiagnosticTool('checkConnectivity', selectedIncidentDetails.asset!.id)}
                      disabled={!!runningDiagnostic}
                      className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-800 rounded border border-slate-800 text-slate-300 transition-colors inline-flex items-center gap-1 hover:border-slate-700"
                    >
                      <TerminalIcon className="w-3 h-3" />
                      Ping
                    </button>
                  </div>
                )}

                {/* Submission Prompt Panels */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  
                  {/* Form 1: Talk to Technician log (Relational DB insert) */}
                  <form onSubmit={handleSendMessage} className="md:col-span-5 flex items-center gap-2">
                    <input
                      type="text"
                      value={techMessage}
                      onChange={(e) => setTechMessage(e.target.value)}
                      placeholder="Registrar mensagem operacional..."
                      className="flex-1 bg-slate-900 border border-slate-800 text-xs rounded px-3 py-2.5 text-slate-200 focus:outline-none focus:border-slate-700 font-sans"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded transition-colors whitespace-nowrap"
                    >
                      Enviar Log
                    </button>
                  </form>

                  {/* Form 2: Query AI Operator RAG (Orchestrator prompt) */}
                  <form onSubmit={handleAiQuery} className="md:col-span-7 flex items-center gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Perguntar à IA: 'Por que o site está fora?' ou 'Qual VPN eu uso?'"
                      className="flex-1 bg-slate-900 border border-slate-800 text-xs rounded px-3 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500/50 font-sans"
                    />
                    <button
                      type="submit"
                      disabled={isAiLoading || !aiPrompt.trim()}
                      className="px-4 py-2.5 text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded transition-colors shadow-lg shadow-cyan-500/10 whitespace-nowrap inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      {isAiLoading ? 'Pensando...' : 'Consultar IA'}
                    </button>
                  </form>

                </div>
              </div>

            </div>

            {/* PANEL 3 (RIGHT SIDEBAR): INCIDENT METADATA & HOST CONTEXT PANEL */}
            <div className="w-80 border-l border-slate-800 bg-slate-950/60 flex flex-col shrink-0 overflow-y-auto">
              
              {/* Incident Details Status Matrix (Section 46) */}
              <div className="p-4 border-b border-slate-800 bg-slate-950/80">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-2">Controles do Incidente</span>
                <div className="space-y-3">
                  
                  {/* Status Indicator (Pure text, Zero Pill) */}
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40">
                    <span className="text-xs text-slate-400 font-sans">Estado Operacional:</span>
                    <span className="text-xs font-mono font-bold tracking-wide text-cyan-400 uppercase">
                      {selectedIncidentDetails?.status}
                    </span>
                  </div>

                  {/* Severity Indicator (Pure text, Zero Pill) */}
                  <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40">
                    <span className="text-xs text-slate-400">Severidade:</span>
                    <span className="text-xs font-mono font-bold text-red-500 uppercase">
                      {selectedIncidentDetails?.severity}
                    </span>
                  </div>

                  {/* Operational Phase Transition Panel */}
                  <div>
                    <label className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Avançar Estado:</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => updateIncidentStatus('TRIAGE')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-850 rounded text-[11px] text-slate-400 hover:text-white border border-slate-800 transition-colors"
                      >
                        Triar
                      </button>
                      <button
                        onClick={() => updateIncidentStatus('COLLECTING_DIAGNOSTICS')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-850 rounded text-[11px] text-slate-400 hover:text-white border border-slate-800 transition-colors"
                      >
                        Diagnosticar
                      </button>
                      <button
                        onClick={() => updateIncidentStatus('SOLUTION_PROPOSED')}
                        className="px-2 py-1 bg-slate-900 hover:bg-slate-850 rounded text-[11px] text-slate-400 hover:text-white border border-slate-800 transition-colors"
                      >
                        Propor Solução
                      </button>
                      <button
                        onClick={() => updateIncidentStatus('RESOLVED')}
                        className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-950/50 rounded text-[11px] text-emerald-400 border border-emerald-900/30 transition-colors"
                      >
                        Resolver
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* Host / Asset detail preview side drawer content */}
              <div className="p-4 space-y-4 flex-1">
                
                {selectedAssetDetail ? (
                  <div className="space-y-4 bg-slate-900/40 p-3 rounded-lg border border-slate-850">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-white">Ativo: {selectedAssetDetail.hostname}</span>
                      <button onClick={() => setSelectedAssetDetail(null)} className="text-xs text-slate-500 hover:text-slate-300 font-mono">Fechar</button>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono">Tipo & OS</div>
                        <div className="text-slate-200 mt-0.5">{selectedAssetDetail.type} · {selectedAssetDetail.operatingSystem} {selectedAssetDetail.version}</div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono">IPs de Rede</div>
                        <div className="text-slate-200 mt-0.5 font-mono">Interno: {selectedAssetDetail.internalIp}</div>
                        <div className="text-slate-200 font-mono">Externo: {selectedAssetDetail.externalIp}</div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono">Ambiente & Datacenter</div>
                        <div className="text-slate-200 mt-0.5">{selectedAssetDetail.environment}</div>
                        <div className="text-slate-400 text-[11px]">{selectedAssetDetail.datacenter}</div>
                      </div>

                      <div>
                        <div className="text-[10px] text-slate-500 uppercase font-mono">Uptime Diagnóstico</div>
                        <div className="text-slate-200 mt-0.5 font-mono">Uptime: 14 dias · CPU: 12%</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500 text-xs">
                    <p>Nenhum Ativo Selecionado.</p>
                    <p className="mt-1">Clique em um ativo no menu esquerdo para expandir especificações.</p>
                  </div>
                )}

                {/* Subnet Mapping & Active Tunnels */}
                <div className="bg-slate-950/40 p-4 rounded-lg border border-slate-850 space-y-2 text-xs">
                  <h4 className="text-xs font-semibold text-slate-200 font-mono uppercase tracking-wider mb-2">Visão de Subnets</h4>
                  <div className="space-y-2">
                    <div>
                      <div className="font-mono text-slate-400">192.168.10.0/24 (CRECI)</div>
                      <div className="text-slate-500 text-[11px]">Túnel IPSec pfSense ativo</div>
                    </div>
                    <div>
                      <div className="font-mono text-slate-400">192.168.20.0/24 (Canada OVH)</div>
                      <div className="text-slate-500 text-[11px]">Sub-rede central proxies</div>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        )}

        {/* VIEW: REPOS & INGESTION PIPELINE */}
        {activeTab === 'repos' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Pipeline de Ingestão de Ativos</h1>
              <p className="text-sm text-slate-400">Upload de arquivos de rede e procedimentos com scanner de segredos em tempo real.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Form Upload Input */}
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Ingerir Novo Documento</h3>
                <form onSubmit={handleFileUpload} className="space-y-4 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Nome do Arquivo:</label>
                    <input
                      type="text"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      placeholder="ex: topologia_crecidf.md"
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Caixa de Destino:</label>
                    <select
                      value={newFileCategory}
                      onChange={(e) => setNewFileCategory(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Caixa de Entrada">Caixa de Entrada</option>
                      <option value="Clientes">Clientes</option>
                      <option value="Infraestrutura">Infraestrutura</option>
                      <option value="Runbooks">Runbooks</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-slate-400">Conteúdo Markdown / Log:</label>
                      <button
                        type="button"
                        onClick={loadExampleIngestDoc}
                        className="text-cyan-400 hover:underline font-mono text-[10px]"
                      >
                        Carregar Exemplo
                      </button>
                    </div>
                    <textarea
                      rows={10}
                      value={newFileContent}
                      onChange={(e) => setNewFileContent(e.target.value)}
                      placeholder="Cole aqui o conteúdo técnico..."
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2.5 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded text-xs transition-colors shadow-lg shadow-cyan-500/10"
                  >
                    Analisar & Sanitizar
                  </button>
                </form>
              </div>

              {/* Parsed Metadata recommendations / Action Drawer */}
              <div className="lg:col-span-2 bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Discovered Metadata Recommendations</h3>
                
                {activeIngestFile ? (
                  <div className="space-y-4 text-xs">
                    <div className="p-3 bg-slate-900/60 rounded border border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-white">Arquivo: {activeIngestFile.fileName}</span>
                        <span className="text-[10px] text-slate-500 font-mono">Data: {new Date(activeIngestFile.uploadedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 whitespace-pre border border-slate-850 p-2.5 bg-slate-950 rounded max-h-40 overflow-y-auto">
                        {activeIngestFile.content}
                      </div>
                    </div>

                    {/* Secrets Scanner Flag */}
                    <div className="p-3 bg-slate-900/40 rounded border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-300">Scanner de Segurança (Passwords & Secrets)</div>
                        <div className="text-slate-500 text-[11px]">Análise automatizada de tokens, passwords e chaves SSH confidenciais.</div>
                      </div>
                      {activeIngestFile.autoExtractedMetadata?.secretsFound ? (
                        <span className="text-[11px] font-mono text-red-400 font-semibold uppercase bg-red-950/20 px-2 py-0.5 rounded border border-red-900/30">
                          CONTEÚDO REDIGIDO
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-emerald-400 font-semibold uppercase bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-900/30">
                          SEGURO (Nenhum segredo)
                        </span>
                      )}
                    </div>

                    {/* Entity Recommendations */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-semibold text-slate-200 uppercase font-mono">Ativos Descobertos:</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {activeIngestFile.autoExtractedMetadata?.assets.map((ast, idx) => (
                          <div key={idx} className="p-3 bg-slate-900/50 rounded border border-slate-850 flex items-center justify-between">
                            <div>
                              <div className="font-bold text-slate-200">{ast.hostname}</div>
                              <div className="text-[11px] text-slate-500 font-mono">{ast.internalIp} · {ast.operatingSystem}</div>
                            </div>
                            <span className="text-[10px] font-mono text-cyan-400 uppercase">NOVO ATIVO</span>
                          </div>
                        ))}
                      </div>

                      <h4 className="text-xs font-semibold text-slate-200 uppercase font-mono pt-2">Conectividade e Relações Detectadas:</h4>
                      <div className="space-y-2">
                        {activeIngestFile.autoExtractedMetadata?.relationships.map((rel, idx) => (
                          <div key={idx} className="p-2.5 bg-slate-900/30 rounded border border-slate-850 flex items-center justify-between text-[11px]">
                            <div className="font-mono">
                              [{rel.sourceAssetId}] {"--("}{rel.type}{")-->"} [{rel.targetAssetId}]
                            </div>
                            <span className="text-[10px] text-slate-500 uppercase">Fase de Revisão</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Promote recommendation to MySQL canonical DB */}
                    <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Promoção do conhecimento ao banco de dados estruturado do cockpit.</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setActiveIngestFile(null)}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded transition-colors"
                        >
                          Rejeitar
                        </button>
                        <button
                          onClick={() => confirmFileIngestion(activeIngestFile.id)}
                          className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded transition-colors flex items-center gap-1"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          Aprovar Ingestão
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-slate-500 text-xs">
                    <p>Nenhum Arquivo Selecionado.</p>
                    <p className="mt-1">Faça upload de um arquivo ou clique no exemplo ao lado para iniciar a extração RAG.</p>
                  </div>
                )}

              </div>

            </div>

            {/* List of previously uploaded files in sandbox */}
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 font-mono">Arquivos Ingeridos e Repositórios</h3>
              <div className="space-y-2">
                {repoFiles.map(file => (
                  <div key={file.id} className="p-3 bg-slate-900/30 rounded border border-slate-850/50 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-slate-200">{file.fileName}</div>
                      <div className="text-slate-500 text-[11px]">
                        Tamanho: {file.fileSize} bytes · Caixa: {file.category} · Status Ingestão:{' '}
                        <span className={`font-mono ${file.status === 'PROCESSED' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {file.status}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveIngestFile(file)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-cyan-400 bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                    >
                      Inspecionar
                    </button>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

        {/* VIEW: KNOWLEDGE BASE AND RUNBOOKS MODULE */}
        {activeTab === 'kb' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
                <p className="text-sm text-slate-400">Repositório canônico de Runbooks, topologias e arquitetura operacional da IBR.</p>
              </div>

              {/* Dynamic search and filters for KB documents */}
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={kbSearch}
                    onChange={(e) => { setKbSearch(e.target.value); fetchInitialData(); }}
                    placeholder="Filtrar runbooks..."
                    className="bg-slate-900 border border-slate-800 text-xs rounded pl-9 pr-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <select
                  value={kbFilterType}
                  onChange={(e) => { setKbFilterType(e.target.value); fetchInitialData(); }}
                  className="bg-slate-900 border border-slate-800 text-xs rounded p-2 text-slate-400 focus:outline-none"
                >
                  <option value="">Todos os Tipos</option>
                  <option value="RUNBOOK">Runbook</option>
                  <option value="ARCHITECTURE">Arquitetura</option>
                  <option value="INCIDENT">Histórico Incidente</option>
                </select>
              </div>
            </div>

            {/* List of Knowledge Docs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {kbDocs.map(doc => (
                <div key={doc.id} className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{doc.category} · {doc.type}</span>
                      <h3 className="font-bold text-slate-100 text-sm mt-0.5">{doc.title}</h3>
                    </div>
                    <span className="text-[11px] font-mono text-cyan-400 font-semibold uppercase bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {doc.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 font-sans prose prose-invert max-w-none prose-sm line-clamp-6 bg-slate-900/30 p-3 rounded border border-slate-900">
                    {doc.content}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>Versão {doc.version} · Criado: {new Date(doc.createdAt).toLocaleDateString()}</span>
                    <span>Verificado por: {doc.verifiedBy || 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Conflicts Management (Section 20) */}
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Reconciliação de Conflitos de Base de Conhecimento</h3>
              
              {kbConflicts.length > 0 ? (
                <div className="space-y-4 text-xs">
                  {kbConflicts.map(conf => (
                    <div key={conf.id} className="p-4 bg-slate-900/40 rounded border border-slate-850 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">Divergência de Ativo: {conf.fieldName}</span>
                        <span className="text-[10px] text-red-400 font-mono font-semibold uppercase">ABERTO</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-3 bg-slate-950 rounded border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase font-mono">Dado Documentado (MySQL)</div>
                          <div className="text-sm font-semibold text-slate-200 mt-1">{conf.documentedValue}</div>
                          <div className="text-[10px] text-slate-500 mt-1">Origem: {conf.documentedOrigin}</div>
                        </div>

                        <div className="p-3 bg-slate-950 rounded border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase font-mono">Dado Observado (Ficheiro/Ingest)</div>
                          <div className="text-sm font-semibold text-amber-400 mt-1">{conf.observedValue}</div>
                          <div className="text-[10px] text-slate-500 mt-1">Origem: {conf.observedOrigin}</div>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">Detectado em: {new Date(conf.observedAt).toLocaleString()}</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => resolveConflict(conf.id, 'reject')}
                            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 text-slate-400 rounded transition-colors"
                          >
                            Rejeitar Novo
                          </button>
                          <button
                            onClick={() => resolveConflict(conf.id, 'keep')}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                          >
                            Manter MySQL
                          </button>
                          <button
                            onClick={() => resolveConflict(conf.id, 'update')}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded transition-colors"
                          >
                            Atualizar MySQL
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">
                  Não existem conflitos ou discrepâncias de infraestrutura detectadas no momento.
                </div>
              )}
            </div>

          </div>
        )}

        {/* VIEW: CLIENTS AND ASSETS REGISTRY */}
        {activeTab === 'clients' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Clientes & Ativos de Rede</h1>
              <p className="text-sm text-slate-400">Estruturação de dados relacionais e especificações de hardware de clientes.</p>
            </div>

            {/* Clients List */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Empresas & Contratos Ativos</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {clients.map(c => (
                  <div key={c.id} className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">Código: {c.code}</span>
                        <h4 className="font-bold text-slate-100 text-base mt-0.5">{c.name}</h4>
                      </div>
                      <span className={`text-xs font-mono font-bold uppercase ${c.criticality === 'CRITICAL' ? 'text-red-500' : 'text-amber-500'}`}>
                        {c.criticality}
                      </span>
                    </div>

                    <div className="text-xs text-slate-300 space-y-1">
                      <div><span className="text-slate-500">SLA de Suporte:</span> <span className="font-mono text-white">{c.sla_hours} horas</span></div>
                      <div><span className="text-slate-500">Domínio Técnico:</span> <span className="font-mono text-white">{c.domain}</span></div>
                    </div>

                    <div className="pt-3 border-t border-slate-850 flex items-center justify-between text-xs text-slate-400">
                      <span>{c.assetCount} Ativos Cadastrados</span>
                      <span>{c.activeIncidentCount} Incidentes em Aberto</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Full assets table registry (Section 22) */}
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Especificação Técnica de Ativos (Inventário)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase">
                      <th className="py-2.5 px-3">Hostname</th>
                      <th className="py-2.5 px-3">Cliente</th>
                      <th className="py-2.5 px-3">Datacenter</th>
                      <th className="py-2.5 px-3">IP Interno</th>
                      <th className="py-2.5 px-3">IP Externo</th>
                      <th className="py-2.5 px-3">OS & Versão</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850">
                    {assets.map(asset => (
                      <tr key={asset.id} className="hover:bg-slate-900/30">
                        <td className="py-3 px-3 font-semibold text-white">{asset.hostname}</td>
                        <td className="py-3 px-3 text-slate-300">{asset.clientCode}</td>
                        <td className="py-3 px-3 text-slate-400">{asset.datacenter}</td>
                        <td className="py-3 px-3 font-mono text-slate-300">{asset.internalIp}</td>
                        <td className="py-3 px-3 font-mono text-slate-300">{asset.externalIp}</td>
                        <td className="py-3 px-3 text-slate-400">{asset.operatingSystem} {asset.version}</td>
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-bold ${asset.status === 'ACTIVE' ? 'text-emerald-400' : 'text-amber-400'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${asset.status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {asset.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* VIEW: AUDIT LOGS IMMUTABLE VIEWER */}
        {activeTab === 'audit' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Registro de Auditoria do Sistema</h1>
              <p className="text-sm text-slate-400">Registros imutáveis de comandos técnicos executados, acessos à IA e alterações de status.</p>
            </div>

            {/* Security Notice */}
            <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-lg flex items-center gap-3 text-xs text-slate-400 leading-relaxed">
              <Shield className="w-10 h-10 text-cyan-400 shrink-0" />
              <div>
                <span className="font-semibold text-white">Aviso de Conformidade e Proteção contra Adulteração</span>
                <p className="mt-0.5">Todos os eventos de infraestrutura, disparos de comandos de diagnóstico, custos estimados de IA e transições de RBAC são logados imutavelmente. Exclusões de relatórios e modificações de trilhas são desativadas de acordo com as regras de conformidade.</p>
              </div>
            </div>

            {/* Audit Logs Table (Section 56) */}
            <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-500 font-mono text-[10px] uppercase">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Operador</th>
                      <th className="py-3 px-4">Ação</th>
                      <th className="py-3 px-4">Detalhes do Evento</th>
                      <th className="py-3 px-4">Risco</th>
                      <th className="py-3 px-4">Modelo IA</th>
                      <th className="py-3 px-4">Custo Est.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-850 font-mono text-[11px] text-slate-300">
                    {auditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-900/20">
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-200">{log.username}</td>
                        <td className="py-3 px-4 text-cyan-400">{log.action}</td>
                        <td className="py-3 px-4 text-slate-300 max-w-xs truncate font-sans" title={log.details}>
                          {log.details}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`font-bold ${log.riskLevel > 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                            L{log.riskLevel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{log.aiModelUsed || 'N/A'}</td>
                        <td className="py-3 px-4 text-slate-500">
                          {log.costEstimated ? `$${log.costEstimated}` : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      </main>

    </div>
  );
}
