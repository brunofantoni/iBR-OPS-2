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
  RefreshCw,
  Plus,
  ChevronRight,
  Download,
  Search,
  BookOpen,
  FileCheck,
  LayoutDashboard,
  Trash2,
  Server,
  Globe,
  Radio
} from 'lucide-react';

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
  type: string;
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
  resolvedAt?: string;
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'operations' | 'repos' | 'kb' | 'clients' | 'audit'>('operations');

  const [currentUser, setCurrentUser] = useState<User>({
    id: 'usr-admin',
    username: 'bruno_admin',
    email: 'bruno.fantoni@inframail.com.br',
    role: 'ADMIN',
    status: 'ACTIVE'
  });

  const [stats, setStats] = useState({
    openCount: 0,
    criticalCount: 0,
    totalAssets: 0,
    totalClients: 0,
    mttrHours: 0.0,
    isMySQLConnected: true,
    recentAudits: [] as AuditLog[]
  });

  const [clients, setClients] = useState<Client[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [relationships, setRelationships] = useState<AssetRelationship[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [kbDocs, setKbDocs] = useState<KnowledgeDocument[]>([]);
  const [kbConflicts, setKbConflicts] = useState<KnowledgeConflict[]>([]);
  const [repoFiles, setRepoFiles] = useState<RepositoryFile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Selected Incident & details
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [selectedIncidentDetails, setSelectedIncidentDetails] = useState<(Incident & { messages: IncidentMessage[]; diagnostics: DiagnosticRun[]; client?: Client; asset?: Asset }) | null>(null);
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [techMessage, setTechMessage] = useState<string>('');
  const [runningDiagnostic, setRunningDiagnostic] = useState<string | null>(null);
  const [diagPort, setDiagPort] = useState<string>('80');

  // Repositories Ingest
  const [newFileName, setNewFileName] = useState<string>('');
  const [newFileContent, setNewFileContent] = useState<string>('');
  const [newFileCategory, setNewFileCategory] = useState<string>('Caixa de Entrada');
  const [activeIngestFile, setActiveIngestFile] = useState<RepositoryFile | null>(null);

  // KB Filters
  const [kbSearch, setKbSearch] = useState<string>('');
  const [kbFilterType, setKbFilterType] = useState<string>('');

  // Selected asset detail side panel
  const [selectedAssetDetail, setSelectedAssetDetail] = useState<Asset | null>(null);

  // Modals for Real Creation in MySQL
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientCode, setNewClientCode] = useState('');
  const [newClientDomain, setNewClientDomain] = useState('');
  const [newClientCriticality, setNewClientCriticality] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [newClientSla, setNewClientSla] = useState('4');

  const [showAssetModal, setShowAssetModal] = useState(false);
  const [newAssetHost, setNewAssetHost] = useState('');
  const [newAssetDisplay, setNewAssetDisplay] = useState('');
  const [newAssetClientId, setNewAssetClientId] = useState('');
  const [newAssetDatacenter, setNewAssetDatacenter] = useState('');
  const [newAssetInternalIp, setNewAssetInternalIp] = useState('');
  const [newAssetExternalIp, setNewAssetExternalIp] = useState('');
  const [newAssetOS, setNewAssetOS] = useState('Linux');
  const [newAssetType, setNewAssetType] = useState('SERVER');

  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [newIncidentTitle, setNewIncidentTitle] = useState('');
  const [newIncidentDesc, setNewIncidentDesc] = useState('');
  const [newIncidentClientId, setNewIncidentClientId] = useState('');
  const [newIncidentAssetId, setNewIncidentAssetId] = useState('');
  const [newIncidentSeverity, setNewIncidentSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('HIGH');

  const [showKbModal, setShowKbModal] = useState(false);
  const [newKbTitle, setNewKbTitle] = useState('');
  const [newKbCategory, setNewKbCategory] = useState('Infraestrutura');
  const [newKbType, setNewKbType] = useState('RUNBOOK');
  const [newKbTags, setNewKbTags] = useState('');
  const [newKbContent, setNewKbContent] = useState('');

  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSession();
    fetchInitialData();
  }, [activeTab]);

  useEffect(() => {
    if (selectedIncidentId) {
      fetchIncidentDetails(selectedIncidentId);
    } else {
      setSelectedIncidentDetails(null);
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
      console.error('Erro ao consultar sessão:', e);
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
        fetchInitialData();
        if (selectedIncidentId) {
          fetchIncidentDetails(selectedIncidentId);
        }
      }
    } catch (e) {
      console.error('Erro ao alternar perfil:', e);
    }
  };

  const fetchInitialData = async () => {
    try {
      const [statsRes, clientsRes, assetsRes, relRes, incidentsRes, kbRes, confRes, reposRes, auditRes] = await Promise.all([
        fetch('/api/dashboard/stats'),
        fetch('/api/clients'),
        fetch('/api/assets'),
        fetch('/api/relationships'),
        fetch('/api/incidents'),
        fetch(`/api/kb?type=${kbFilterType}&search=${kbSearch}`),
        fetch('/api/kb/conflicts'),
        fetch('/api/repos'),
        fetch('/api/audit-logs')
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
      if (assetsRes.ok) setAssets(await assetsRes.json());
      if (relRes.ok) setRelationships(await relRes.json());

      if (incidentsRes.ok) {
        const incidentsData = await incidentsRes.json();
        setIncidents(incidentsData);
        if (incidentsData.length > 0 && !selectedIncidentId) {
          setSelectedIncidentId(incidentsData[0].id);
        } else if (incidentsData.length === 0) {
          setSelectedIncidentId('');
          setSelectedIncidentDetails(null);
        }
      }

      if (kbRes.ok) setKbDocs(await kbRes.json());
      if (confRes.ok) setKbConflicts(await confRes.json());
      if (reposRes.ok) setRepoFiles(await reposRes.json());
      if (auditRes.ok) setAuditLogs(await auditRes.json());
    } catch (e) {
      console.error('Erro ao sincronizar dados com o MySQL:', e);
    }
  };

  const fetchIncidentDetails = async (id: string) => {
    try {
      const res = await fetch(`/api/incidents/${id}`);
      if (res.ok) {
        setSelectedIncidentDetails(await res.json());
      }
    } catch (e) {
      console.error('Erro ao carregar detalhes do incidente:', e);
    }
  };

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
      console.error('Erro ao enviar mensagem:', e);
    }
  };

  const handleAiQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || !selectedIncidentId || isAiLoading) return;

    setIsAiLoading(true);
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
      console.error('Erro na consulta à IA:', e);
    } finally {
      setIsAiLoading(false);
    }
  };

  const executeDiagnosticTool = async (toolName: string, assetId: string) => {
    if (!selectedIncidentId || runningDiagnostic) return;

    if (currentUser.role === 'VIEWER') {
      alert('Acesso negado: Perfil Visualizador não possui permissão para disparar testes de rede.');
      return;
    }

    setRunningDiagnostic(toolName);
    try {
      const res = await fetch(`/api/incidents/${selectedIncidentId}/diagnose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName,
          assetId,
          targetPort: diagPort
        })
      });
      if (res.ok) {
        fetchIncidentDetails(selectedIncidentId);
      }
    } catch (e) {
      console.error('Falha no diagnóstico:', e);
    } finally {
      setRunningDiagnostic(null);
    }
  };

  const updateIncidentStatus = async (status: Incident['status']) => {
    if (!selectedIncidentId) return;
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
      console.error('Erro ao atualizar status:', e);
    }
  };

  // Real CRUD Actions for MySQL
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientCode) return;

    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newClientName,
          code: newClientCode,
          domain: newClientDomain,
          criticality: newClientCriticality,
          sla_hours: newClientSla
        })
      });
      if (res.ok) {
        setShowClientModal(false);
        setNewClientName('');
        setNewClientCode('');
        setNewClientDomain('');
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao criar cliente no MySQL:', e);
    }
  };

  const handleDeleteClient = async (id: string, name: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Apenas Administradores podem excluir clientes no MySQL.');
      return;
    }
    if (!confirm(`Tem certeza que deseja excluir o cliente "${name}" e seus ativos do MySQL?`)) return;

    try {
      const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      if (res.ok) fetchInitialData();
    } catch (e) {
      console.error('Erro ao excluir cliente:', e);
    }
  };

  const handleCreateAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssetHost) return;

    try {
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostname: newAssetHost,
          displayName: newAssetDisplay || newAssetHost,
          clientId: newAssetClientId,
          datacenter: newAssetDatacenter || 'Datacenter Central',
          internalIp: newAssetInternalIp,
          externalIp: newAssetExternalIp,
          operatingSystem: newAssetOS,
          type: newAssetType
        })
      });
      if (res.ok) {
        setShowAssetModal(false);
        setNewAssetHost('');
        setNewAssetDisplay('');
        setNewAssetInternalIp('');
        setNewAssetExternalIp('');
        setNewAssetDatacenter('');
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao cadastrar ativo no MySQL:', e);
    }
  };

  const handleDeleteAsset = async (id: string, hostname: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Apenas Administradores podem excluir ativos no MySQL.');
      return;
    }
    if (!confirm(`Excluir o ativo "${hostname}" do MySQL canônico?`)) return;

    try {
      const res = await fetch(`/api/assets/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedAssetDetail?.id === id) setSelectedAssetDetail(null);
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao excluir ativo:', e);
    }
  };

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIncidentTitle) return;

    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newIncidentTitle,
          description: newIncidentDesc,
          clientId: newIncidentClientId,
          assetId: newIncidentAssetId,
          severity: newIncidentSeverity
        })
      });
      if (res.ok) {
        const created = await res.json();
        setShowIncidentModal(false);
        setNewIncidentTitle('');
        setNewIncidentDesc('');
        setSelectedIncidentId(created.id);
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao abrir incidente no MySQL:', e);
    }
  };

  const handleDeleteIncident = async (id: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Apenas Administradores podem excluir incidentes no MySQL.');
      return;
    }
    if (!confirm('Tem certeza que deseja excluir este incidente do MySQL?')) return;

    try {
      const res = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedIncidentId === id) setSelectedIncidentId('');
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao excluir incidente:', e);
    }
  };

  const handleCreateKbDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKbTitle || !newKbContent) return;

    try {
      const res = await fetch('/api/kb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newKbTitle,
          category: newKbCategory,
          type: newKbType,
          tags: newKbTags,
          content: newKbContent
        })
      });
      if (res.ok) {
        setShowKbModal(false);
        setNewKbTitle('');
        setNewKbTags('');
        setNewKbContent('');
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao criar documento KB no MySQL:', e);
    }
  };

  const handleDeleteKbDoc = async (id: string, title: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Apenas Administradores podem excluir documentos da KB.');
      return;
    }
    if (!confirm(`Excluir o documento "${title}" do MySQL?`)) return;

    try {
      const res = await fetch(`/api/kb/${id}`, { method: 'DELETE' });
      if (res.ok) fetchInitialData();
    } catch (e) {
      console.error('Erro ao excluir documento KB:', e);
    }
  };

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
      console.error('Falha no upload do arquivo:', e);
    }
  };

  const confirmFileIngestion = async (fileId: string) => {
    if (currentUser.role !== 'ADMIN') {
      alert('Somente administradores podem aprovar a ingestão de dados ao MySQL canônico.');
      return;
    }

    try {
      const res = await fetch(`/api/repos/confirm-ingest/${fileId}`, { method: 'POST' });
      if (res.ok) {
        setActiveIngestFile(null);
        fetchInitialData();
      }
    } catch (e) {
      console.error('Erro ao confirmar ingestão:', e);
    }
  };

  // Group assets dynamically by datacenter
  const datacentersList = Array.from(new Set(assets.map(a => a.datacenter || 'Geral')));
  const subnetsList = Array.from(
    new Set(
      assets
        .filter(a => a.internalIp && a.internalIp.includes('.'))
        .map(a => a.internalIp.split('.').slice(0, 3).join('.') + '.0/24')
    )
  );

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col antialiased selection:bg-cyan-500/30 selection:text-white">
      
      {/* 1. TOP BAR */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-800 bg-slate-950 sticky top-0 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            IBR Ops
          </span>
          <span className="text-xs text-slate-500 font-mono select-none">v1.2.0</span>
          
          {/* Real MySQL Connection Badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono">
            <span className={`h-2 w-2 rounded-full ${stats.isMySQLConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-slate-400">MYSQL 8:</span>
            <span className={stats.isMySQLConnected ? 'text-emerald-400 font-semibold' : 'text-red-400'}>
              web008.ibrcloud.com.br / ibrops_aiops
            </span>
          </div>
        </div>

        {/* Navigation Tabs */}
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

        {/* Profile Switcher & Actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <span className="text-[11px] font-mono text-slate-500 uppercase px-1.5">Perfil:</span>
            <button
              onClick={() => handleRoleChange('VIEWER')}
              className={`px-2 py-0.5 text-xs font-medium rounded ${currentUser.role === 'VIEWER' ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Viewer
            </button>
            <button
              onClick={() => handleRoleChange('TECHNICIAN')}
              className={`px-2 py-0.5 text-xs font-medium rounded ${currentUser.role === 'TECHNICIAN' ? 'bg-blue-600/30 text-blue-300' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Tech
            </button>
            <button
              onClick={() => handleRoleChange('ADMIN')}
              className={`px-2 py-0.5 text-xs font-medium rounded ${currentUser.role === 'ADMIN' ? 'bg-cyan-600/30 text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}
            >
              Admin
            </button>
          </div>
          <div className="hidden sm:block text-right">
            <div className="text-xs font-semibold text-slate-200">{currentUser.username}</div>
            <div className="text-[10px] font-mono text-slate-500">{currentUser.email}</div>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="flex-1 overflow-hidden flex flex-col">
        
        {/* VIEW: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-7xl mx-auto w-full">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard Canônico MySQL</h1>
                <p className="text-slate-400 text-sm">Métricas reais obtidas diretamente de web008.ibrcloud.com.br.</p>
              </div>
              <button onClick={fetchInitialData} className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700">
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar MySQL
              </button>
            </div>

            {/* Stat Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Incidentes Abertos</div>
                <div className="text-4xl font-extrabold text-white mt-1 font-mono tracking-tight">{stats.openCount}</div>
                <div className="text-[11px] text-slate-500 mt-2">Chamados ativos no MySQL</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Severidade Crítica</div>
                <div className="text-4xl font-extrabold text-red-500 mt-1 font-mono tracking-tight">{stats.criticalCount}</div>
                <div className="text-[11px] text-slate-500 mt-2">Casos com prioridade alta ou crítica</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">MTTR Médio Real</div>
                <div className="text-4xl font-extrabold text-white mt-1 font-mono tracking-tight">{stats.mttrHours}h</div>
                <div className="text-[11px] text-slate-500 mt-2">Calculado a partir dos chamados resolvidos</div>
              </div>

              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs uppercase font-mono tracking-wider">Ativos em Inventário</div>
                <div className="text-4xl font-extrabold text-cyan-400 mt-1 font-mono tracking-tight">{stats.totalAssets}</div>
                <div className="text-[11px] text-slate-500 mt-2">Servidores e instâncias reais</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Clients SLA List */}
              <div className="lg:col-span-2 bg-slate-950 p-5 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Clientes Cadastrados no MySQL</h3>
                    <button
                      onClick={() => setShowClientModal(true)}
                      className="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Novo Cliente
                    </button>
                  </div>

                  {clients.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 text-xs">
                      Nenhum cliente cadastrado no MySQL. Clique em "Novo Cliente" acima para registrar empresas e SLAs.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {clients.map(c => (
                        <div key={c.id} className="pb-3 border-b border-slate-850 flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-slate-200">{c.name}</div>
                            <div className="text-xs text-slate-500">
                              Domínio: {c.domain} · SLA: <span className="font-mono text-slate-400">{c.sla_hours}h</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono font-bold text-white">{c.assetCount || 0} ativos</div>
                            <span className="text-[11px] font-mono text-cyan-400">{c.criticality}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Audit Logs */}
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 flex flex-col justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 font-mono">Atividades Registradas</h3>
                  {stats.recentAudits.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">Nenhum evento registrado ainda.</div>
                  ) : (
                    <div className="space-y-3">
                      {stats.recentAudits.map(log => (
                        <div key={log.id} className="text-xs pb-2.5 border-b border-slate-850 last:border-0">
                          <div className="flex items-center justify-between font-mono text-slate-500">
                            <span>{log.username} · {log.action}</span>
                            <span>{new Date(log.timestamp).toLocaleTimeString('pt-BR')}</span>
                          </div>
                          <p className="text-slate-300 mt-0.5 truncate">{log.details}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setActiveTab('audit')}
                  className="w-full text-center mt-4 text-xs font-semibold text-cyan-400 hover:text-cyan-300 pt-3 border-t border-slate-800 flex items-center justify-center gap-1"
                >
                  Ver Auditoria Completa
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: OPERATIONS COCKPIT */}
        {activeTab === 'operations' && (
          <div className="flex-1 flex overflow-hidden">
            
            {/* PANEL 1 (LEFT): REAL ASSETS & TOPOLOGY FROM MYSQL */}
            <div className="w-80 border-r border-slate-800 bg-slate-950/40 flex flex-col shrink-0">
              <div className="p-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-400">Ativos no MySQL</span>
                <button
                  onClick={() => setShowAssetModal(true)}
                  className="text-cyan-400 hover:text-cyan-300 text-xs font-mono flex items-center gap-1"
                  title="Cadastrar Ativo Real"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ativo
                </button>
              </div>

              {/* Incidents Selector */}
              <div className="p-3 border-b border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-slate-500 uppercase tracking-wider font-mono block">Incidente Selecionado:</label>
                  <button
                    onClick={() => setShowIncidentModal(true)}
                    className="text-[10px] text-cyan-400 hover:underline font-mono"
                  >
                    + Novo
                  </button>
                </div>
                {incidents.length === 0 ? (
                  <div className="text-xs text-slate-500 italic p-1">Nenhum chamado aberto.</div>
                ) : (
                  <select
                    value={selectedIncidentId}
                    onChange={(e) => setSelectedIncidentId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded p-2 focus:border-cyan-500 focus:outline-none"
                  >
                    {incidents.map(inc => (
                      <option key={inc.id} value={inc.id}>
                        [{inc.severity}] {inc.title.substring(0, 32)}...
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Dynamic Assets by Real Datacenter in MySQL */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {assets.length === 0 ? (
                  <div className="text-center py-10 px-4 text-xs text-slate-500">
                    <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="font-semibold text-slate-400">Nenhum ativo cadastrado.</p>
                    <p className="mt-1">Cadastre seus servidores reais (ex: web040, web008) para monitorar e diagnosticar.</p>
                    <button
                      onClick={() => setShowAssetModal(true)}
                      className="mt-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded text-xs inline-flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" /> Cadastrar Primeiro Ativo
                    </button>
                  </div>
                ) : (
                  datacentersList.map(dc => (
                    <div key={dc}>
                      <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest px-1 mb-1.5">{dc}</div>
                      <div className="space-y-1">
                        {assets.filter(a => (a.datacenter || 'Geral') === dc).map(a => (
                          <button
                            key={a.id}
                            onClick={() => setSelectedAssetDetail(a)}
                            className={`w-full text-left p-2.5 rounded text-xs flex items-center justify-between transition-colors ${selectedAssetDetail?.id === a.id ? 'bg-slate-800 border-l-2 border-cyan-400' : 'bg-slate-900/40 hover:bg-slate-800/50'}`}
                          >
                            <div className="truncate pr-2">
                              <div className="font-semibold text-slate-200 truncate">{a.hostname}</div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {a.internalIp || a.externalIp || 'Sem IP'} · {a.type}
                              </div>
                            </div>
                            <span className={`h-2 w-2 rounded-full ${a.status === 'ACTIVE' ? 'bg-emerald-500' : a.status === 'DEGRADED' ? 'bg-amber-500' : 'bg-red-500'}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}

                {/* Real Relationships / Tunnels */}
                {relationships.length > 0 && (
                  <div className="pt-2 border-t border-slate-850">
                    <div className="text-[10px] font-mono text-slate-500 uppercase tracking-widest px-1 mb-1.5">Relacionamentos e Conexões</div>
                    <div className="space-y-1.5">
                      {relationships.map(rel => {
                        const src = assets.find(a => a.id === rel.sourceAssetId);
                        const tgt = assets.find(a => a.id === rel.targetAssetId);
                        return (
                          <div key={rel.id} className="p-2 bg-slate-950/80 rounded border border-slate-850 text-[11px] font-mono">
                            <div className="text-slate-300 font-medium">
                              {src?.hostname || rel.sourceAssetId} → {tgt?.hostname || rel.targetAssetId}
                            </div>
                            <div className="text-slate-500 text-[10px]">{rel.type}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-500">
                <span className="font-mono text-slate-400">Banco: MySQL 8 Canônico</span>
              </div>
            </div>

            {/* PANEL 2 (CENTER): WORKBENCH & REAL DIAGNOSTICS */}
            <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-950/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono uppercase text-slate-500">Operador: {currentUser.username}</span>
                  <h2 className="text-sm font-semibold text-white mt-0.5">
                    {selectedIncidentDetails?.title || 'Selecione ou abra um chamado para diagnosticar'}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Diagnóstico:</span>
                  <span className="text-xs font-mono font-bold uppercase text-emerald-400">Tempo Real (Rede Nativa)</span>
                </div>
              </div>

              {/* Incident Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {selectedIncidentDetails ? (
                  <>
                    <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-lg">
                      <div className="flex items-center justify-between font-mono text-xs text-slate-500 mb-1">
                        <span>DETALHES DO INCIDENTE</span>
                        <span>Severidade: {selectedIncidentDetails.severity}</span>
                      </div>
                      <p className="text-slate-300 text-xs">{selectedIncidentDetails.description || 'Sem descrição adicional.'}</p>
                    </div>

                    {selectedIncidentDetails.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex flex-col max-w-4xl p-3.5 rounded-lg text-xs leading-relaxed ${
                          msg.sender === 'IA_AGENT'
                            ? 'bg-slate-950 border border-cyan-500/20 text-slate-100 self-start mr-8'
                            : msg.sender === 'SYSTEM'
                            ? 'bg-slate-950/60 border border-slate-800 text-slate-300 self-center max-w-2xl w-full'
                            : 'bg-slate-800/80 text-white self-end ml-8'
                        }`}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px] text-slate-500 mb-1.5 pb-1 border-b border-slate-800/50">
                          <span className="font-bold text-slate-400 uppercase tracking-wide">{msg.senderName}</span>
                          <span>{new Date(msg.createdAt).toLocaleTimeString('pt-BR')}</span>
                        </div>
                        {msg.message.startsWith('[DIAGNÓSTICO REAL]') ? (
                          <div className="font-mono whitespace-pre bg-slate-900 p-2.5 rounded text-cyan-300 border border-slate-800 overflow-x-auto text-[11px]">
                            {msg.message}
                          </div>
                        ) : (
                          <div className="whitespace-pre-line text-slate-200">
                            {msg.message}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-500">
                    <Activity className="w-10 h-10 mb-2 opacity-30" />
                    <p className="text-sm font-semibold text-slate-400">Nenhum chamado selecionado</p>
                    <p className="text-xs max-w-sm mt-1">Abra um incidente ou selecione um existente no menu esquerdo para iniciar os diagnósticos reais de rede.</p>
                    <button
                      onClick={() => setShowIncidentModal(true)}
                      className="mt-4 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded"
                    >
                      Abrir Novo Incidente
                    </button>
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Bottom Real Diagnostic Bar & AI prompt */}
              {selectedIncidentDetails && (
                <div className="p-4 border-t border-slate-850 bg-slate-950/60 space-y-3">
                  
                  {/* Real Network Tools Bar */}
                  {selectedIncidentDetails.asset && (
                    <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-slate-850 text-xs">
                      <span className="text-[10px] text-slate-500 uppercase font-mono">Testes de Rede Reais para {selectedIncidentDetails.asset.hostname}:</span>
                      
                      <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-800 font-mono text-xs">
                        <span className="text-slate-500 text-[10px]">Porta:</span>
                        <input
                          type="number"
                          value={diagPort}
                          onChange={(e) => setDiagPort(e.target.value)}
                          className="w-12 bg-transparent text-white focus:outline-none"
                        />
                      </div>

                      <button
                        onClick={() => executeDiagnosticTool('checkPort', selectedIncidentDetails.asset!.id)}
                        disabled={!!runningDiagnostic}
                        className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-850 rounded border border-slate-800 text-slate-200 transition-colors inline-flex items-center gap-1"
                      >
                        <Radio className="w-3 h-3 text-cyan-400" />
                        Testar Porta TCP (Socket)
                      </button>

                      <button
                        onClick={() => executeDiagnosticTool('checkHttp', selectedIncidentDetails.asset!.id)}
                        disabled={!!runningDiagnostic}
                        className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-850 rounded border border-slate-800 text-slate-200 transition-colors inline-flex items-center gap-1"
                      >
                        <Globe className="w-3 h-3 text-cyan-400" />
                        Testar HTTP (Status & Headers)
                      </button>

                      <button
                        onClick={() => executeDiagnosticTool('checkConnectivity', selectedIncidentDetails.asset!.id)}
                        disabled={!!runningDiagnostic}
                        className="px-2.5 py-1 text-[11px] font-mono bg-slate-900 hover:bg-slate-850 rounded border border-slate-800 text-slate-200 transition-colors inline-flex items-center gap-1"
                      >
                        <Network className="w-3 h-3 text-cyan-400" />
                        DNS / Ping
                      </button>
                    </div>
                  )}

                  {/* Input Forms */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <form onSubmit={handleSendMessage} className="md:col-span-5 flex items-center gap-2">
                      <input
                        type="text"
                        value={techMessage}
                        onChange={(e) => setTechMessage(e.target.value)}
                        placeholder="Registrar mensagem no MySQL..."
                        className="flex-1 bg-slate-900 border border-slate-800 text-xs rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-slate-700 font-sans"
                      />
                      <button
                        type="submit"
                        className="px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                      >
                        Gravar
                      </button>
                    </form>

                    <form onSubmit={handleAiQuery} className="md:col-span-7 flex items-center gap-2">
                      <input
                        type="text"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Perguntar à IA com base no MySQL (ex: 'Diagnosticar conexão com web040')"
                        className="flex-1 bg-slate-900 border border-slate-800 text-xs rounded px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500/50"
                      />
                      <button
                        type="submit"
                        disabled={isAiLoading || !aiPrompt.trim()}
                        className="px-4 py-2 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {isAiLoading ? 'Consultando...' : 'Consultar IA'}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>

            {/* PANEL 3 (RIGHT): HOST SPECIFICATIONS & STATUS TRANSITIONS */}
            <div className="w-80 border-l border-slate-800 bg-slate-950/60 flex flex-col shrink-0 overflow-y-auto">
              {selectedIncidentDetails && (
                <div className="p-4 border-b border-slate-800 bg-slate-950">
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-2">Ciclo do Chamado</span>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-800">
                      <span className="text-slate-400">Estado:</span>
                      <span className="font-mono font-bold text-cyan-400">{selectedIncidentDetails.status}</span>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-500 font-mono uppercase block mb-1">Mudar Estado:</label>
                      <div className="grid grid-cols-2 gap-1.5 text-xs">
                        <button
                          onClick={() => updateIncidentStatus('TRIAGE')}
                          className="px-2 py-1 bg-slate-900 hover:bg-slate-800 rounded text-slate-400 hover:text-white border border-slate-800"
                        >
                          Triagem
                        </button>
                        <button
                          onClick={() => updateIncidentStatus('COLLECTING_DIAGNOSTICS')}
                          className="px-2 py-1 bg-slate-900 hover:bg-slate-800 rounded text-slate-400 hover:text-white border border-slate-800"
                        >
                          Diagnóstico
                        </button>
                        <button
                          onClick={() => updateIncidentStatus('SOLUTION_PROPOSED')}
                          className="px-2 py-1 bg-slate-900 hover:bg-slate-800 rounded text-slate-400 hover:text-white border border-slate-800"
                        >
                          Propor Solução
                        </button>
                        <button
                          onClick={() => updateIncidentStatus('RESOLVED')}
                          className="px-2 py-1 bg-emerald-950/30 hover:bg-emerald-950/50 rounded text-emerald-400 border border-emerald-900/30 font-semibold"
                        >
                          Resolver
                        </button>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        onClick={() => handleDeleteIncident(selectedIncidentDetails.id)}
                        className="text-xs text-red-400 hover:text-red-300 font-mono flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Excluir Chamado
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Host detail drawer */}
              <div className="p-4 space-y-4 flex-1">
                {selectedAssetDetail ? (
                  <div className="space-y-3 bg-slate-900/40 p-3 rounded-lg border border-slate-850 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white truncate">{selectedAssetDetail.hostname}</span>
                      <button onClick={() => setSelectedAssetDetail(null)} className="text-slate-500 hover:text-slate-300">Fechar</button>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-mono">Tipo & SO</div>
                      <div className="text-slate-200 mt-0.5">{selectedAssetDetail.type} · {selectedAssetDetail.operatingSystem}</div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-mono">Endereços IP</div>
                      <div className="text-slate-200 font-mono">Interno: {selectedAssetDetail.internalIp || 'N/A'}</div>
                      <div className="text-slate-200 font-mono">Externo: {selectedAssetDetail.externalIp || 'N/A'}</div>
                    </div>

                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-mono">Datacenter / Ambiente</div>
                      <div className="text-slate-200">{selectedAssetDetail.datacenter} ({selectedAssetDetail.environment})</div>
                    </div>

                    <div className="pt-2 border-t border-slate-800">
                      <button
                        onClick={() => handleDeleteAsset(selectedAssetDetail.id, selectedAssetDetail.hostname)}
                        className="text-red-400 hover:text-red-300 font-mono text-xs flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Excluir do MySQL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-slate-500 text-xs">
                    Clique em um ativo no menu esquerdo para inspecionar configurações e endereços de rede.
                  </div>
                )}

                {/* Real Subnets detected from assets in MySQL */}
                <div className="bg-slate-950/40 p-3.5 rounded-lg border border-slate-850 space-y-2 text-xs">
                  <h4 className="text-xs font-semibold text-slate-300 font-mono uppercase tracking-wider">Subnets Cadastradas</h4>
                  {subnetsList.length === 0 ? (
                    <div className="text-slate-500 text-[11px]">Nenhuma subnet detectada nos ativos atuais.</div>
                  ) : (
                    <div className="space-y-1">
                      {subnetsList.map(sn => (
                        <div key={sn} className="font-mono text-slate-400 text-xs">{sn}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* VIEW: REPOSITÓRIOS & INGESTÃO */}
        {activeTab === 'repos' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Ingestão de Documentação Técnica</h1>
              <p className="text-sm text-slate-400">Envie arquivos de configuração, inventário ou procedimentos para extrair dados para o MySQL.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Upload de Documento</h3>
                <form onSubmit={handleFileUpload} className="space-y-4 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Nome do Arquivo:</label>
                    <input
                      type="text"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      placeholder="ex: inventario_web040.txt"
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Categoria:</label>
                    <select
                      value={newFileCategory}
                      onChange={(e) => setNewFileCategory(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Caixa de Entrada">Caixa de Entrada</option>
                      <option value="Infraestrutura">Infraestrutura</option>
                      <option value="Clientes">Clientes</option>
                      <option value="Runbooks">Runbooks</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Conteúdo:</label>
                    <textarea
                      rows={8}
                      value={newFileContent}
                      onChange={(e) => setNewFileContent(e.target.value)}
                      placeholder="Cole aqui o texto, logs ou configurações do servidor..."
                      className="w-full bg-slate-900 border border-slate-800 rounded p-2.5 font-mono text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded text-xs transition-colors"
                  >
                    Processar e Sanitizar Segredos
                  </button>
                </form>
              </div>

              {/* Extraction Preview */}
              <div className="lg:col-span-2 bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Entidades Identificadas</h3>
                {activeIngestFile ? (
                  <div className="space-y-4 text-xs">
                    <div className="p-3 bg-slate-900/60 rounded border border-slate-800">
                      <div className="flex items-center justify-between mb-1.5 font-mono">
                        <span className="font-semibold text-white">{activeIngestFile.fileName}</span>
                        <span className="text-slate-500 text-[10px]">{new Date(activeIngestFile.uploadedAt).toLocaleString()}</span>
                      </div>
                      <div className="font-mono text-xs text-slate-400 whitespace-pre p-2 bg-slate-950 rounded max-h-36 overflow-y-auto">
                        {activeIngestFile.content}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-slate-200 uppercase font-mono">Servidores / Ativos Extraídos:</h4>
                      {activeIngestFile.autoExtractedMetadata?.assets && activeIngestFile.autoExtractedMetadata.assets.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {activeIngestFile.autoExtractedMetadata.assets.map((ast, idx) => (
                            <div key={idx} className="p-2.5 bg-slate-900 rounded border border-slate-850">
                              <div className="font-bold text-white">{ast.hostname}</div>
                              <div className="text-[11px] text-slate-400 font-mono">{ast.internalIp || 'Sem IP'} · {ast.type}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-slate-500 text-[11px]">Nenhum ativo detectado no texto.</div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                      <button
                        onClick={() => setActiveIngestFile(null)}
                        className="px-3 py-1.5 bg-slate-900 text-slate-400 rounded"
                      >
                        Descartar
                      </button>
                      <button
                        onClick={() => confirmFileIngestion(activeIngestFile.id)}
                        className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded flex items-center gap-1"
                      >
                        <FileCheck className="w-3.5 h-3.5" />
                        Gravar Ativos no MySQL
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-slate-500 text-xs">
                    Faça upload de um arquivo para extrair entidades e associar à infraestrutura real.
                  </div>
                )}
              </div>
            </div>

            {/* Ingested History */}
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider mb-4 font-mono">Histórico de Arquivos no MySQL</h3>
              {repoFiles.length === 0 ? (
                <div className="text-center py-6 text-slate-500 text-xs">Nenhum arquivo armazenado no MySQL.</div>
              ) : (
                <div className="space-y-2">
                  {repoFiles.map(file => (
                    <div key={file.id} className="p-3 bg-slate-900/40 rounded border border-slate-850 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-200">{file.fileName}</div>
                        <div className="text-slate-500 text-[11px]">
                          Tamanho: {file.fileSize} bytes · Status: <span className="font-mono text-cyan-400">{file.status}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setActiveIngestFile(file)}
                        className="px-2.5 py-1 text-xs text-cyan-400 bg-slate-800 hover:bg-slate-700 rounded"
                      >
                        Abrir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW: KNOWLEDGE BASE */}
        {activeTab === 'kb' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">Knowledge Base (Armazenada no MySQL)</h1>
                <p className="text-sm text-slate-400">Runbooks, procedimentos de operação e histórico de soluções.</p>
              </div>

              <div className="flex items-center gap-2">
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
                <button
                  onClick={() => setShowKbModal(true)}
                  className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Novo Documento
                </button>
              </div>
            </div>

            {kbDocs.length === 0 ? (
              <div className="text-center py-16 bg-slate-950 rounded-lg border border-slate-800 text-slate-500 text-xs">
                <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="font-semibold text-slate-400">Nenhum documento de conhecimento cadastrado no MySQL.</p>
                <p className="mt-1">Clique em "Novo Documento" para cadastrar runbooks operacionais reais.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {kbDocs.map(doc => (
                  <div key={doc.id} className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-slate-500 uppercase">{doc.category} · {doc.type}</span>
                          <h3 className="font-bold text-slate-100 text-sm mt-0.5">{doc.title}</h3>
                        </div>
                        <button
                          onClick={() => handleDeleteKbDoc(doc.id, doc.title)}
                          className="text-slate-600 hover:text-red-400"
                          title="Excluir do MySQL"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-300 whitespace-pre-line mt-3 line-clamp-6 bg-slate-900/30 p-3 rounded border border-slate-850">
                        {doc.content}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono pt-3 border-t border-slate-850">
                      <span>Atualizado: {new Date(doc.updatedAt).toLocaleDateString('pt-BR')}</span>
                      <span>Autor: {doc.verifiedBy || 'N/A'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: CLIENTS & ASSETS */}
        {activeTab === 'clients' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white">Clientes & Ativos Canônicos</h1>
                <p className="text-sm text-slate-400">Dados estruturados gerenciados diretamente na tabela MySQL de ibrops_aiops.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowClientModal(true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded text-xs font-semibold flex items-center gap-1 border border-slate-700"
                >
                  <Plus className="w-3.5 h-3.5" /> Novo Cliente
                </button>
                <button
                  onClick={() => setShowAssetModal(true)}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-semibold flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Novo Ativo
                </button>
              </div>
            </div>

            {/* Clients Grid */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Clientes</h3>
              {clients.length === 0 ? (
                <div className="p-6 bg-slate-950 rounded-lg border border-slate-800 text-center text-slate-500 text-xs">
                  Nenhum cliente cadastrado no MySQL.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {clients.map(c => (
                    <div key={c.id} className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-slate-500 uppercase">{c.code}</span>
                          <h4 className="font-bold text-slate-100 text-sm">{c.name}</h4>
                        </div>
                        <button
                          onClick={() => handleDeleteClient(c.id, c.name)}
                          className="text-slate-600 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-400">
                        Domínio: <span className="font-mono text-slate-300">{c.domain}</span> · SLA: <span className="font-mono text-slate-300">{c.sla_hours}h</span>
                      </div>
                      <div className="text-xs font-mono text-slate-500 pt-2 border-t border-slate-850 flex justify-between">
                        <span>{c.assetCount || 0} Ativos</span>
                        <span>{c.criticality}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Assets Table */}
            <div className="bg-slate-950 p-5 rounded-lg border border-slate-800 space-y-4">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider font-mono">Tabela de Ativos Reais</h3>
              {assets.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Nenhum ativo cadastrado. Clique no botão "Novo Ativo" acima para registrar um servidor.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase">
                        <th className="py-2.5 px-3">Hostname</th>
                        <th className="py-2.5 px-3">Cliente</th>
                        <th className="py-2.5 px-3">Datacenter</th>
                        <th className="py-2.5 px-3">IP Interno</th>
                        <th className="py-2.5 px-3">IP Externo</th>
                        <th className="py-2.5 px-3">SO</th>
                        <th className="py-2.5 px-3 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {assets.map(asset => (
                        <tr key={asset.id} className="hover:bg-slate-900/30">
                          <td className="py-3 px-3 font-semibold text-white">{asset.hostname}</td>
                          <td className="py-3 px-3 text-slate-300">{asset.clientCode}</td>
                          <td className="py-3 px-3 text-slate-400">{asset.datacenter}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{asset.internalIp || '-'}</td>
                          <td className="py-3 px-3 font-mono text-slate-300">{asset.externalIp || '-'}</td>
                          <td className="py-3 px-3 text-slate-400">{asset.operatingSystem}</td>
                          <td className="py-3 px-3 text-right">
                            <button
                              onClick={() => handleDeleteAsset(asset.id, asset.hostname)}
                              className="text-slate-600 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5 inline" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
            <div className="pb-4 border-b border-slate-800">
              <h1 className="text-2xl font-bold text-white">Auditoria MySQL de ibrops_aiops</h1>
              <p className="text-sm text-slate-400">Trilha de auditoria gravada em tempo real com timestamp e autor.</p>
            </div>

            <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-500 font-mono text-[10px] uppercase">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Operador</th>
                      <th className="py-3 px-4">Ação</th>
                      <th className="py-3 px-4">Detalhes</th>
                      <th className="py-3 px-4">Risco</th>
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
                        <td className="py-3 px-4 text-slate-300 font-sans">{log.details}</td>
                        <td className="py-3 px-4">
                          <span className={`font-bold ${log.riskLevel > 0 ? 'text-amber-500' : 'text-slate-500'}`}>
                            L{log.riskLevel}
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

      </main>

      {/* MODAL: NOVO CLIENTE */}
      {showClientModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-white">Cadastrar Novo Cliente no MySQL</h3>
            <form onSubmit={handleCreateClient} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Nome do Cliente / Órgão:</label>
                <input
                  type="text"
                  required
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="ex: Tribunal Regional"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Código Identificador:</label>
                <input
                  type="text"
                  required
                  value={newClientCode}
                  onChange={(e) => setNewClientCode(e.target.value)}
                  placeholder="ex: TRF_01"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500 uppercase font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Domínio Principal:</label>
                <input
                  type="text"
                  value={newClientDomain}
                  onChange={(e) => setNewClientDomain(e.target.value)}
                  placeholder="ex: cliente.ibrcloud.com.br"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Criticidade:</label>
                  <select
                    value={newClientCriticality}
                    onChange={(e: any) => setNewClientCriticality(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">SLA (horas):</label>
                  <input
                    type="number"
                    value={newClientSla}
                    onChange={(e) => setNewClientSla(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowClientModal(false)}
                  className="px-3 py-1.5 bg-slate-900 text-slate-400 rounded"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                >
                  Salvar no MySQL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO ATIVO */}
      {showAssetModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-white">Cadastrar Novo Ativo no MySQL</h3>
            <form onSubmit={handleCreateAsset} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Hostname (ex: WEB040):</label>
                <input
                  type="text"
                  required
                  value={newAssetHost}
                  onChange={(e) => setNewAssetHost(e.target.value)}
                  placeholder="ex: web040.ibrcloud.com.br ou WEB040"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Nome de Exibição:</label>
                <input
                  type="text"
                  value={newAssetDisplay}
                  onChange={(e) => setNewAssetDisplay(e.target.value)}
                  placeholder="ex: Servidor Web 040 Radar"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Cliente Vinculado:</label>
                  <select
                    value={newAssetClientId}
                    onChange={(e) => setNewAssetClientId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="">Nenhum (Infra Central)</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Datacenter / Local:</label>
                  <input
                    type="text"
                    value={newAssetDatacenter}
                    onChange={(e) => setNewAssetDatacenter(e.target.value)}
                    placeholder="ex: Equinix Brasil ou web040"
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">IP Interno:</label>
                  <input
                    type="text"
                    value={newAssetInternalIp}
                    onChange={(e) => setNewAssetInternalIp(e.target.value)}
                    placeholder="ex: 192.168.1.40"
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">IP Externo / Domínio:</label>
                  <input
                    type="text"
                    value={newAssetExternalIp}
                    onChange={(e) => setNewAssetExternalIp(e.target.value)}
                    placeholder="ex: web040.ibrcloud.com.br"
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Tipo:</label>
                  <select
                    value={newAssetType}
                    onChange={(e) => setNewAssetType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="SERVER">SERVER</option>
                    <option value="PROXY">PROXY</option>
                    <option value="DATABASE">DATABASE</option>
                    <option value="FIREWALL">FIREWALL</option>
                    <option value="VM">VM</option>
                    <option value="CONTAINER">CONTAINER</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Sistema Operacional:</label>
                  <input
                    type="text"
                    value={newAssetOS}
                    onChange={(e) => setNewAssetOS(e.target.value)}
                    placeholder="ex: AlmaLinux 9 ou Debian 12"
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAssetModal(false)}
                  className="px-3 py-1.5 bg-slate-900 text-slate-400 rounded"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                >
                  Gravar no MySQL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO INCIDENTE */}
      {showIncidentModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-white">Abrir Novo Incidente no MySQL</h3>
            <form onSubmit={handleCreateIncident} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Título do Incidente:</label>
                <input
                  type="text"
                  required
                  value={newIncidentTitle}
                  onChange={(e) => setNewIncidentTitle(e.target.value)}
                  placeholder="ex: Falha de conexão na porta 80 do web040"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Descrição do Problema:</label>
                <textarea
                  rows={3}
                  value={newIncidentDesc}
                  onChange={(e) => setNewIncidentDesc(e.target.value)}
                  placeholder="Descreva o sintoma ou alerta recebido..."
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Cliente Afetado:</label>
                  <select
                    value={newIncidentClientId}
                    onChange={(e) => setNewIncidentClientId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="">Geral / IBR Cloud</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-slate-400 block mb-1">Ativo Vinculado:</label>
                  <select
                    value={newIncidentAssetId}
                    onChange={(e) => setNewIncidentAssetId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                  >
                    <option value="">Nenhum / Selecionar depois</option>
                    {assets.map(a => (
                      <option key={a.id} value={a.id}>{a.hostname}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Severidade:</label>
                <select
                  value={newIncidentSeverity}
                  onChange={(e: any) => setNewIncidentSeverity(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIncidentModal(false)}
                  className="px-3 py-1.5 bg-slate-900 text-slate-400 rounded"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                >
                  Abrir Chamado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NOVO DOCUMENTO KB */}
      {showKbModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-6 max-w-lg w-full space-y-4">
            <h3 className="text-base font-bold text-white">Cadastrar Runbook no MySQL</h3>
            <form onSubmit={handleCreateKbDoc} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">Título:</label>
                <input
                  type="text"
                  required
                  value={newKbTitle}
                  onChange={(e) => setNewKbTitle(e.target.value)}
                  placeholder="ex: Procedimento de Restart do Nginx"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-slate-400 block mb-1">Categoria:</label>
                  <input
                    type="text"
                    value={newKbCategory}
                    onChange={(e) => setNewKbCategory(e.target.value)}
                    placeholder="ex: Web Server"
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Tipo:</label>
                  <select
                    value={newKbType}
                    onChange={(e) => setNewKbType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white"
                  >
                    <option value="RUNBOOK">RUNBOOK</option>
                    <option value="ARCHITECTURE">ARCHITECTURE</option>
                    <option value="INCIDENT">INCIDENT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Tags (separadas por vírgula):</label>
                <input
                  type="text"
                  value={newKbTags}
                  onChange={(e) => setNewKbTags(e.target.value)}
                  placeholder="ex: nginx, restart, web040"
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Conteúdo (Markdown):</label>
                <textarea
                  rows={6}
                  required
                  value={newKbContent}
                  onChange={(e) => setNewKbContent(e.target.value)}
                  placeholder="Instruções passo a passo..."
                  className="w-full bg-slate-900 border border-slate-800 rounded p-2.5 font-mono text-xs text-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowKbModal(false)}
                  className="px-3 py-1.5 bg-slate-900 text-slate-400 rounded"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded"
                >
                  Salvar no MySQL
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
