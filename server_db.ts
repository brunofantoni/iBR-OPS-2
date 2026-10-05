import fs from 'fs';
import path from 'path';
import { isMySQLConnected, query, initMySQL } from './mysql_db';

// server_db.ts - Relational persistence layer for IBR Ops
// Integrates remote MySQL 8 on web008.ibrcloud.com.br and falls back to local JSON dynamically.

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Interface structures matching standard relational models
export interface User {
  id: string;
  username: string;
  email: string;
  role: 'ADMIN' | 'TECHNICIAN' | 'VIEWER';
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Client {
  id: string;
  name: string;
  code: string; // e.g. CRECI_DF
  domain: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'ACTIVE' | 'INACTIVE';
  sla_hours: number;
  createdAt: string;
}

export interface ClientContact {
  id: string;
  clientId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

export interface Asset {
  id: string;
  clientId: string;
  datacenter: string; // e.g. WEB020 (Canada), WEB008 (Brasil)
  environment: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT';
  type: 'PHYSICAL_SERVER' | 'VM' | 'CONTAINER' | 'FIREWALL' | 'ROUTER' | 'SWITCH' | 'PROXY' | 'DATABASE' | 'APPLICATION' | 'STORAGE' | 'BACKUP_SERVER' | 'CLOUD_SERVICE' | 'OTHER';
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
}

export interface AssetRelationship {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  type: 'CONNECTED_TO' | 'VPN_CONNECTED_TO' | 'ROUTES_TO' | 'PROXIES' | 'LOAD_BALANCES' | 'HOSTS' | 'DEPENDS_ON' | 'BACKS_UP' | 'REPLICATES_TO' | 'MONITORS' | 'SERVES' | 'PROTECTED_BY' | 'RESOLVES_TO';
  origin: 'MANUAL' | 'DOCUMENT' | 'DISCOVERY' | 'PFSENSE' | 'PROXMOX' | 'SSH' | 'ZABBIX' | 'CLOUDFLARE' | 'OTHER';
  status: 'ACTIVE' | 'DEGRADED' | 'INACTIVE';
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  clientId?: string; // If specific to client
  environment?: string;
  type: 'GLOBAL' | 'CLIENT' | 'TECHNOLOGY' | 'RUNBOOK' | 'INCIDENT' | 'POLICY' | 'ARCHITECTURE' | 'HISTORICAL';
  category: string;
  criticality: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  tags: string[];
  status: 'DRAFT' | 'VERIFIED' | 'CANONICAL' | 'SUPERSEDED' | 'ARCHIVED';
  content: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  version: number;
}

export interface KnowledgeConflict {
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

export interface RepositoryFile {
  id: string;
  fileName: string;
  fileSize: number;
  category: 'Caixa de Entrada' | 'IBR Global' | 'Clientes' | 'Infraestrutura' | 'Runbooks' | 'Incidentes Históricos' | 'Descobertas' | 'Arquivados';
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

export interface Incident {
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
  escalatedAt?: string;
  escalationReason?: string;
}

export interface IncidentMessage {
  id: string;
  incidentId: string;
  sender: 'IA_AGENT' | 'TECHNICIAN' | 'ADMIN' | 'SYSTEM';
  senderName: string;
  message: string;
  createdAt: string;
}

export interface AuditLog {
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

export interface DiagnosticRun {
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

// Full Relational State Database Representation
export interface DBState {
  users: User[];
  clients: Client[];
  client_contacts: ClientContact[];
  assets: Asset[];
  asset_relationships: AssetRelationship[];
  knowledge_documents: KnowledgeDocument[];
  knowledge_conflicts: KnowledgeConflict[];
  repository_files: RepositoryFile[];
  incidents: Incident[];
  incident_messages: IncidentMessage[];
  audit_logs: AuditLog[];
  diagnostic_runs: DiagnosticRun[];
}

const DEFAULT_DB_STATE: DBState = {
  users: [
    { id: 'usr-1', username: 'bruno_admin', email: 'bruno.fantoni@inframail.com.br', role: 'ADMIN', status: 'ACTIVE' },
    { id: 'usr-2', username: 'tech_diego', email: 'diego.tecnico@inframail.com.br', role: 'TECHNICIAN', status: 'ACTIVE' },
    { id: 'usr-3', username: 'viewer_clara', email: 'clara.viewer@inframail.com.br', role: 'VIEWER', status: 'ACTIVE' }
  ],
  clients: [
    { id: 'cli-1', name: 'CRECI DF - Conselho Regional de Corretores de Imóveis', code: 'CRECI_DF', domain: 'crecidf.org.br', criticality: 'HIGH', status: 'ACTIVE', sla_hours: 4, createdAt: '2026-01-15T10:00:00Z' },
    { id: 'cli-2', name: 'IBR Global Services', code: 'IBR_GLOBAL', domain: 'ibrcloud.com.br', criticality: 'CRITICAL', status: 'ACTIVE', sla_hours: 2, createdAt: '2026-01-01T08:00:00Z' }
  ],
  client_contacts: [
    { id: 'cnt-1', clientId: 'cli-1', name: 'Dr. Geraldo Silva', email: 'geral@crecidf.org.br', phone: '(61) 3328-1010', role: 'Diretor de TI' },
    { id: 'cnt-2', clientId: 'cli-2', name: 'Bruno Fantoni', email: 'bruno.fantoni@inframail.com.br', phone: '(11) 99999-8888', role: 'Diretor Operacional' }
  ],
  assets: [
    { id: 'ast-020', clientId: 'cli-2', datacenter: 'Canadá (OVH)', environment: 'PRODUCTION', type: 'PROXY', hostname: 'WEB020', displayName: 'WEB020 Proxy Central', internalIp: '192.168.20.20', externalIp: '198.50.120.20', operatingSystem: 'AlmaLinux 9', version: '9.4', criticality: 'CRITICAL', status: 'ACTIVE', lastDiscovery: '2026-10-05T00:00:00Z', lastValidation: '2026-10-05T03:00:00Z' },
    { id: 'ast-008', clientId: 'cli-2', datacenter: 'Brasil (Equinix)', environment: 'PRODUCTION', type: 'PROXY', hostname: 'WEB008', displayName: 'WEB008 Proxy Local', internalIp: '192.168.8.8', externalIp: '200.120.8.8', operatingSystem: 'AlmaLinux 9', version: '9.4', criticality: 'CRITICAL', status: 'ACTIVE', lastDiscovery: '2026-10-05T01:00:00Z', lastValidation: '2026-10-05T03:00:00Z' },
    { id: 'ast-101', clientId: 'cli-1', datacenter: 'Canadá (OVH)', environment: 'PRODUCTION', type: 'APPLICATION', hostname: 'APP01', displayName: 'CRECI APP01 Webserver', internalIp: '192.168.10.11', externalIp: '198.50.120.31', operatingSystem: 'AlmaLinux 9', version: '9.4', criticality: 'HIGH', status: 'DEGRADED', lastDiscovery: '2026-10-05T01:15:00Z', lastValidation: '2026-10-05T03:15:00Z' },
    { id: 'ast-102', clientId: 'cli-1', datacenter: 'Canadá (OVH)', environment: 'PRODUCTION', type: 'DATABASE', hostname: 'DB01', displayName: 'CRECI DB01 Database', internalIp: '192.168.10.12', externalIp: '198.50.120.32', operatingSystem: 'Rocky Linux 9', version: '9.3', criticality: 'HIGH', status: 'ACTIVE', lastDiscovery: '2026-10-05T01:20:00Z', lastValidation: '2026-10-05T03:20:00Z' }
  ],
  asset_relationships: [
    { id: 'rel-1', sourceAssetId: 'ast-020', targetAssetId: 'ast-008', type: 'VPN_CONNECTED_TO', origin: 'DISCOVERY', status: 'ACTIVE' },
    { id: 'rel-2', sourceAssetId: 'ast-101', targetAssetId: 'ast-102', type: 'DEPENDS_ON', origin: 'DOCUMENT', status: 'ACTIVE' },
    { id: 'rel-3', sourceAssetId: 'ast-020', targetAssetId: 'ast-101', type: 'PROXIES', origin: 'DISCOVERY', status: 'ACTIVE' }
  ],
  knowledge_documents: [
    {
      id: 'doc-1',
      title: 'Runbook: Diagnóstico de Erro 502 Bad Gateway no Proxy WEB020',
      clientId: 'cli-2',
      type: 'RUNBOOK',
      category: 'Proxy Web',
      criticality: 'HIGH',
      tags: ['nginx', '502', 'web020', 'backend-offline'],
      status: 'CANONICAL',
      content: `### Procedimento de Diagnóstico Nginx 502 Bad Gateway...`,
      createdAt: '2026-02-10T14:00:00Z',
      updatedAt: '2026-02-10T14:00:00Z',
      verifiedAt: '2026-02-11T10:00:00Z',
      verifiedBy: 'bruno_admin',
      version: 1
    }
  ],
  knowledge_conflicts: [],
  repository_files: [],
  incidents: [
    {
      id: 'inc-1',
      clientId: 'cli-1',
      assetId: 'ast-101',
      title: 'Portal do CRECI DF retornando HTTP 502 Bad Gateway no Proxy Central',
      description: 'O portal institucional do CRECI DF está inacessível. O proxy central WEB020 exibe erro 502 Bad Gateway ao tentar encaminhar requisições para o servidor de aplicação APP01.',
      status: 'NEW',
      severity: 'HIGH',
      createdAt: '2026-10-05T03:00:00Z',
      updatedAt: '2026-10-05T03:00:00Z'
    }
  ],
  incident_messages: [
    {
      id: 'msg-1',
      incidentId: 'inc-1',
      sender: 'SYSTEM',
      senderName: 'Monitoramento IBR',
      message: 'Alerta recebido do Proxy WEB020: Upstream APP01 (192.168.10.11) parou de responder na porta 80.',
      createdAt: '2026-10-05T03:01:00Z'
    }
  ],
  audit_logs: [
    {
      id: 'aud-1',
      userId: 'usr-1',
      username: 'bruno_admin',
      action: 'BOOTSTRAP',
      details: 'Inicialização canônica do sistema e preenchimento da carga inicial de clientes e ativos.',
      riskLevel: 0,
      timestamp: '2026-10-05T03:42:00Z'
    }
  ],
  diagnostic_runs: []
};

class SimulatedDatabase {
  private state: DBState = { ...DEFAULT_DB_STATE };
  private mysqlLoaded = false;

  constructor() {
    this.init();
  }

  private async init() {
    // 1. Load simulated file database
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileContent = fs.readFileSync(DB_FILE, 'utf-8');
        this.state = JSON.parse(fileContent);
      } catch (e) {
        this.state = { ...DEFAULT_DB_STATE };
      }
    } else {
      this.state = { ...DEFAULT_DB_STATE };
      this.save();
    }

    // 2. Trigger asynchronous MySQL connection handshake
    try {
      await initMySQL();
      this.mysqlLoaded = true;
    } catch (e) {
      console.warn('MySQL init exception, continuing in simulated file mode.', e);
    }
  }

  public save() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (e) {
      console.error('Falha ao persistir banco simulado.', e);
    }
  }

  // Generic and Entity specific operations with MySQL routing
  public getState(): DBState {
    return this.state;
  }

  public async getUsers(): Promise<User[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM users');
        return rows as User[];
      } catch (e) {
        console.error('MySQL getUsers fail, using local state.', e);
      }
    }
    return this.state.users;
  }

  public async getClients(): Promise<Client[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM clients');
        return rows as Client[];
      } catch (e) {
        console.error('MySQL getClients fail, using local state.', e);
      }
    }
    return this.state.clients;
  }

  public async getClientContacts(clientId: string): Promise<ClientContact[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM client_contacts WHERE clientId = ?', [clientId]);
        return rows as ClientContact[];
      } catch (e) {
        console.error('MySQL getClientContacts fail, using local state.', e);
      }
    }
    return this.state.client_contacts.filter(c => c.clientId === clientId);
  }

  public async getAssets(): Promise<Asset[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM assets');
        return rows as Asset[];
      } catch (e) {
        console.error('MySQL getAssets fail, using local state.', e);
      }
    }
    return this.state.assets;
  }

  public async getAssetRelationships(): Promise<AssetRelationship[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM asset_relationships');
        return rows as AssetRelationship[];
      } catch (e) {
        console.error('MySQL getAssetRelationships fail, using local state.', e);
      }
    }
    return this.state.asset_relationships;
  }

  public async getKnowledgeDocs(): Promise<KnowledgeDocument[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM knowledge_documents');
        const docs = rows.map((r: any) => ({
          ...r,
          tags: r.tags ? r.tags.split(',').map((t: string) => t.trim()) : []
        }));
        return docs as KnowledgeDocument[];
      } catch (e) {
        console.error('MySQL getKnowledgeDocs fail, using local state.', e);
      }
    }
    return this.state.knowledge_documents;
  }

  public async getConflicts(): Promise<KnowledgeConflict[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM knowledge_conflicts');
        return rows as KnowledgeConflict[];
      } catch (e) {
        console.error('MySQL getConflicts fail, using local state.', e);
      }
    }
    return this.state.knowledge_conflicts;
  }

  public async getRepositoryFiles(): Promise<RepositoryFile[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM repository_files');
        return rows.map((r: any) => ({
          ...r,
          autoExtractedMetadata: r.autoExtractedMetadata ? JSON.parse(r.autoExtractedMetadata) : undefined
        })) as RepositoryFile[];
      } catch (e) {
        console.error('MySQL getRepositoryFiles fail, using local state.', e);
      }
    }
    return this.state.repository_files;
  }

  public async getIncidents(): Promise<Incident[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM incidents');
        return rows as Incident[];
      } catch (e) {
        console.error('MySQL getIncidents fail, using local state.', e);
      }
    }
    return this.state.incidents;
  }

  public async getIncidentMessages(incidentId: string): Promise<IncidentMessage[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM incident_messages WHERE incidentId = ?', [incidentId]);
        return rows as IncidentMessage[];
      } catch (e) {
        console.error('MySQL getIncidentMessages fail, using local state.', e);
      }
    }
    return this.state.incident_messages.filter(m => m.incidentId === incidentId);
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
        return rows as AuditLog[];
      } catch (e) {
        console.error('MySQL getAuditLogs fail, using local state.', e);
      }
    }
    return this.state.audit_logs;
  }

  public async getDiagnosticRuns(incidentId?: string): Promise<DiagnosticRun[]> {
    if (isMySQLConnected) {
      try {
        let sql = 'SELECT * FROM diagnostic_runs';
        const params: any[] = [];
        if (incidentId) {
          sql += ' WHERE incidentId = ?';
          params.push(incidentId);
        }
        sql += ' ORDER BY timestamp DESC';
        const rows = await query(sql, params);
        return rows as DiagnosticRun[];
      } catch (e) {
        console.error('MySQL getDiagnosticRuns fail, using local state.', e);
      }
    }
    if (incidentId) {
      return this.state.diagnostic_runs.filter(d => d.incidentId === incidentId);
    }
    return this.state.diagnostic_runs;
  }

  // Insertion helper operations mimicking SQL transactions
  public async insertAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog> {
    const newLog: AuditLog = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      ...log
    };
    
    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO audit_logs 
          (id, userId, username, clientId, incidentId, action, details, toolUsed, riskLevel, aiModelUsed, tokensUsed, costEstimated, latencyMs, timestamp) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newLog.id, newLog.userId, newLog.username, newLog.clientId || null, newLog.incidentId || null, newLog.action, newLog.details, newLog.toolUsed || null, newLog.riskLevel, newLog.aiModelUsed || null, newLog.tokensUsed || null, newLog.costEstimated || null, newLog.latencyMs || null, newLog.timestamp]
        );
      } catch (e) {
        console.error('MySQL insertAuditLog fail, using local state fallback.', e);
      }
    }

    this.state.audit_logs.unshift(newLog);
    this.save();
    return newLog;
  }

  public async insertIncidentMessage(msg: Omit<IncidentMessage, 'id' | 'createdAt'>): Promise<IncidentMessage> {
    const newMsg: IncidentMessage = {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      ...msg
    };

    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO incident_messages (id, incidentId, sender, senderName, message, createdAt) 
          VALUES (?, ?, ?, ?, ?, ?)`,
          [newMsg.id, newMsg.incidentId, newMsg.sender, newMsg.senderName, newMsg.message, newMsg.createdAt]
        );
      } catch (e) {
        console.error('MySQL insertIncidentMessage fail, using local state fallback.', e);
      }
    }

    this.state.incident_messages.push(newMsg);
    this.save();
    return newMsg;
  }

  public async updateIncidentStatus(incidentId: string, status: Incident['status']): Promise<Incident | undefined> {
    const incident = this.state.incidents.find(i => i.id === incidentId);
    const resolvedAt = status === 'RESOLVED' ? new Date().toISOString() : null;
    const updatedAt = new Date().toISOString();

    if (isMySQLConnected) {
      try {
        await query('UPDATE incidents SET status = ?, updatedAt = ?, resolvedAt = ? WHERE id = ?', 
          [status, updatedAt, resolvedAt, incidentId]
        );
      } catch (e) {
        console.error('MySQL updateIncidentStatus fail, using local state fallback.', e);
      }
    }

    if (incident) {
      incident.status = status;
      incident.updatedAt = updatedAt;
      if (status === 'RESOLVED') {
        incident.resolvedAt = resolvedAt || undefined;
      }
      this.save();
      return incident;
    }
    return undefined;
  }

  public async updateIncidentSeverity(incidentId: string, severity: Incident['severity']): Promise<Incident | undefined> {
    const incident = this.state.incidents.find(i => i.id === incidentId);
    const updatedAt = new Date().toISOString();

    if (isMySQLConnected) {
      try {
        await query('UPDATE incidents SET severity = ?, updatedAt = ? WHERE id = ?', 
          [severity, updatedAt, incidentId]
        );
      } catch (e) {
        console.error('MySQL updateIncidentSeverity fail, using local state fallback.', e);
      }
    }

    if (incident) {
      incident.severity = severity;
      incident.updatedAt = updatedAt;
      this.save();
      return incident;
    }
    return undefined;
  }

  public async insertDiagnosticRun(run: Omit<DiagnosticRun, 'id' | 'timestamp'>): Promise<DiagnosticRun> {
    const newRun: DiagnosticRun = {
      id: `dia-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      ...run
    };

    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO diagnostic_runs (id, incidentId, assetId, toolName, commandExecuted, riskLevel, stdout, status, executedBy, timestamp) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newRun.id, newRun.incidentId, newRun.assetId, newRun.toolName, newRun.commandExecuted, newRun.riskLevel, newRun.stdout, newRun.status, newRun.executedBy, newRun.timestamp]
        );
      } catch (e) {
        console.error('MySQL insertDiagnosticRun fail, using local state fallback.', e);
      }
    }

    this.state.diagnostic_runs.unshift(newRun);
    this.save();
    return newRun;
  }

  public async insertKnowledgeDoc(doc: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<KnowledgeDocument> {
    const newDoc: KnowledgeDocument = {
      id: `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      ...doc
    };

    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO knowledge_documents (id, title, clientId, environment, type, category, criticality, tags, status, content, createdAt, updatedAt, version) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newDoc.id, newDoc.title, newDoc.clientId || null, newDoc.environment || null, newDoc.type, newDoc.category, newDoc.criticality, newDoc.tags.join(','), newDoc.status, newDoc.content, newDoc.createdAt, newDoc.updatedAt, newDoc.version]
        );
      } catch (e) {
        console.error('MySQL insertKnowledgeDoc fail, using local state fallback.', e);
      }
    }

    this.state.knowledge_documents.unshift(newDoc);
    this.save();
    return newDoc;
  }

  public async insertKnowledgeConflict(conflict: Omit<KnowledgeConflict, 'id' | 'observedAt' | 'status'>): Promise<KnowledgeConflict> {
    const newConflict: KnowledgeConflict = {
      id: `cf-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      observedAt: new Date().toISOString(),
      status: 'OPEN',
      ...conflict
    };

    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO knowledge_conflicts (id, documentId, fieldName, documentedValue, documentedOrigin, observedValue, observedOrigin, observedAt, status) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newConflict.id, newConflict.documentId, newConflict.fieldName, newConflict.documentedValue, newConflict.documentedOrigin, newConflict.observedValue, newConflict.observedOrigin, newConflict.observedAt, newConflict.status]
        );
      } catch (e) {
        console.error('MySQL insertKnowledgeConflict fail, using local state fallback.', e);
      }
    }

    this.state.knowledge_conflicts.unshift(newConflict);
    this.save();
    return newConflict;
  }

  public async resolveKnowledgeConflict(conflictId: string, action: 'keep' | 'update' | 'reject'): Promise<boolean> {
    const conflict = this.state.knowledge_conflicts.find(c => c.id === conflictId);
    if (!conflict) return false;

    conflict.status = 'RESOLVED';

    if (isMySQLConnected) {
      try {
        await query('UPDATE knowledge_conflicts SET status = "RESOLVED" WHERE id = ?', [conflictId]);
      } catch (e) {
        console.error('MySQL resolveKnowledgeConflict fail, using local state fallback.', e);
      }
    }

    if (action === 'update') {
      const doc = this.state.knowledge_documents.find(d => d.id === conflict.documentId);
      if (doc) {
        // Implement field replacement
        if (conflict.fieldName === 'internalIp') {
          const asset = this.state.assets.find(a => a.hostname === doc.title.match(/APP\d+|DB\d+/)?.[0]);
          if (asset) {
            asset.internalIp = conflict.observedValue;
            asset.lastValidation = new Date().toISOString();

            if (isMySQLConnected) {
              try {
                await query('UPDATE assets SET internalIp = ?, lastValidation = ? WHERE id = ?', 
                  [conflict.observedValue, asset.lastValidation, asset.id]
                );
              } catch (e) {
                console.error('MySQL asset update fail.', e);
              }
            }
          }
        }
        doc.updatedAt = new Date().toISOString();
        doc.version += 1;

        if (isMySQLConnected) {
          try {
            await query('UPDATE knowledge_documents SET updatedAt = ?, version = ? WHERE id = ?', 
              [doc.updatedAt, doc.version, doc.id]
            );
          } catch (e) {
            console.error('MySQL document update fail.', e);
          }
        }
      }
    }

    this.save();
    return true;
  }

  public async insertRepositoryFile(file: Omit<RepositoryFile, 'id' | 'uploadedAt'>): Promise<RepositoryFile> {
    const newFile: RepositoryFile = {
      id: `rep-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      uploadedAt: new Date().toISOString(),
      ...file
    };

    if (isMySQLConnected) {
      try {
        await query(`INSERT INTO repository_files (id, fileName, fileSize, category, status, content, uploadedAt, autoExtractedMetadata) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newFile.id, newFile.fileName, newFile.fileSize, newFile.category, newFile.status, newFile.content, newFile.uploadedAt, newFile.autoExtractedMetadata ? JSON.stringify(newFile.autoExtractedMetadata) : null]
        );
      } catch (e) {
        console.error('MySQL insertRepositoryFile fail, using local state fallback.', e);
      }
    }

    this.state.repository_files.push(newFile);
    this.save();
    return newFile;
  }

  public async approveIngestedMetadata(fileId: string): Promise<boolean> {
    const file = this.state.repository_files.find(f => f.id === fileId);
    if (!file || !file.autoExtractedMetadata) return false;

    const metadata = file.autoExtractedMetadata;

    // Persist discovered clients if not exists
    for (const cName of metadata.clients) {
      const exists = this.state.clients.some(c => c.name.toLowerCase() === cName.toLowerCase() || c.code.toLowerCase() === cName.toLowerCase());
      if (!exists) {
        const code = cName.toUpperCase().replace(/\s+/g, '_');
        const newClient: Client = {
          id: `cli-${Date.now()}-${Math.floor(Math.random() * 100)}`,
          name: cName,
          code,
          domain: `${code.toLowerCase()}.ibrcloud.com`,
          criticality: 'MEDIUM',
          status: 'ACTIVE',
          sla_hours: 4,
          createdAt: new Date().toISOString()
        };
        
        if (isMySQLConnected) {
          try {
            await query(`INSERT INTO clients (id, name, code, domain, criticality, status, sla_hours, createdAt) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [newClient.id, newClient.name, newClient.code, newClient.domain, newClient.criticality, newClient.status, newClient.sla_hours, newClient.createdAt]
            );
          } catch (e) {
            console.error('MySQL client insertion failed.', e);
          }
        }
        this.state.clients.push(newClient);
      }
    }

    // Locate or create the correct client association
    const defaultClient = this.state.clients.find(c => metadata.clients.some(mc => mc.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(mc.toLowerCase()))) || this.state.clients[0];

    // Persist discovered assets
    for (const newAsset of metadata.assets) {
      const exists = this.state.assets.find(a => a.hostname === newAsset.hostname && a.clientId === defaultClient.id);
      if (exists) {
        // Check for conflicts
        if (newAsset.internalIp && exists.internalIp !== newAsset.internalIp) {
          await this.insertKnowledgeConflict({
            documentId: 'doc-2', // Linked to topology config doc
            fieldName: 'internalIp',
            documentedValue: exists.internalIp,
            documentedOrigin: 'MySQL Database System',
            observedValue: newAsset.internalIp,
            observedOrigin: `Ingestão de arquivo: ${file.fileName}`
          });
        } else {
          // Normal validation
          exists.lastValidation = new Date().toISOString();
          if (isMySQLConnected) {
            try {
              await query('UPDATE assets SET lastValidation = ? WHERE id = ?', [exists.lastValidation, exists.id]);
            } catch (e) {
              console.error('MySQL asset validation update fail.', e);
            }
          }
        }
      } else {
        // Create new asset
        const createdAsset: Asset = {
          id: `ast-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          clientId: defaultClient.id,
          datacenter: 'Canadá (OVH)',
          environment: 'PRODUCTION',
          type: newAsset.type || 'VM',
          hostname: newAsset.hostname || 'NEW_HOST',
          displayName: `${defaultClient.code} ${newAsset.hostname || 'New Asset'}`,
          internalIp: newAsset.internalIp || '192.168.10.254',
          externalIp: '198.50.120.' + Math.floor(Math.random() * 200 + 10),
          operatingSystem: newAsset.operatingSystem || 'AlmaLinux 9',
          version: '9.4',
          criticality: 'MEDIUM',
          status: 'ACTIVE',
          lastDiscovery: new Date().toISOString(),
          lastValidation: new Date().toISOString()
        };

        if (isMySQLConnected) {
          try {
            await query(`INSERT INTO assets (id, clientId, datacenter, environment, type, hostname, displayName, internalIp, externalIp, operatingSystem, version, status, lastDiscovery, lastValidation) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [createdAsset.id, createdAsset.clientId, createdAsset.datacenter, createdAsset.environment, createdAsset.type, createdAsset.hostname, createdAsset.displayName, createdAsset.internalIp, createdAsset.externalIp, createdAsset.operatingSystem, createdAsset.version, createdAsset.status, createdAsset.lastDiscovery, createdAsset.lastValidation]
            );
          } catch (e) {
            console.error('MySQL asset creation failed.', e);
          }
        }
        this.state.assets.push(createdAsset);
      }
    }

    // Generate connections
    for (const rel of metadata.relationships) {
      const srcAsset = this.state.assets.find(a => a.hostname === rel.sourceAssetId);
      const tgtAsset = this.state.assets.find(a => a.hostname === rel.targetAssetId);
      if (srcAsset && tgtAsset) {
        const relationshipExists = this.state.asset_relationships.some(
          r => r.sourceAssetId === srcAsset.id && r.targetAssetId === tgtAsset.id && r.type === rel.type
        );
        if (!relationshipExists) {
          const newRel: AssetRelationship = {
            id: `rel-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            sourceAssetId: srcAsset.id,
            targetAssetId: tgtAsset.id,
            type: rel.type || 'DEPENDS_ON',
            origin: 'DISCOVERY',
            status: 'ACTIVE'
          };

          if (isMySQLConnected) {
            try {
              await query('INSERT INTO asset_relationships (id, sourceAssetId, targetAssetId, type, origin, status) VALUES (?, ?, ?, ?, ?, ?)',
                [newRel.id, newRel.sourceAssetId, newRel.targetAssetId, newRel.type, newRel.origin, newRel.status]
              );
            } catch (e) {
              console.error('MySQL relationship insertion failed.', e);
            }
          }
          this.state.asset_relationships.push(newRel);
        }
      }
    }

    file.status = 'PROCESSED';
    if (isMySQLConnected) {
      try {
        await query('UPDATE repository_files SET status = "PROCESSED" WHERE id = ?', [fileId]);
      } catch (e) {
        console.error('MySQL file processed update failed.', e);
      }
    }

    this.save();
    return true;
  }
}

export const db = new SimulatedDatabase();
export { isMySQLConnected };
