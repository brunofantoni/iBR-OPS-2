import fs from 'fs';
import path from 'path';
import { isMySQLConnected, query, initMySQL } from './mysql_db';

// server_db.ts - Relational persistence layer for IBR Ops
// Real MySQL 8 on web008.ibrcloud.com.br - NO MOCKUPS.

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
  code: string;
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
}

export interface AssetRelationship {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  type: string;
  origin: string;
  status: string;
}

export interface KnowledgeDocument {
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

// Clean state without any mockups
const CLEAN_DB_STATE: DBState = {
  users: [
    { id: 'usr-admin', username: 'bruno_admin', email: 'bruno.fantoni@inframail.com.br', role: 'ADMIN', status: 'ACTIVE' }
  ],
  clients: [],
  client_contacts: [],
  assets: [],
  asset_relationships: [],
  knowledge_documents: [],
  knowledge_conflicts: [],
  repository_files: [],
  incidents: [],
  incident_messages: [],
  audit_logs: [],
  diagnostic_runs: []
};

class MySQLDatabaseManager {
  private state: DBState = { ...CLEAN_DB_STATE };

  constructor() {
    this.init();
  }

  private async init() {
    try {
      await initMySQL();
    } catch (e) {
      console.warn('MySQL init exception:', e);
    }
  }

  public save() {
    // Kept as no-op or local fallback sync
    if (fs.existsSync(DATA_DIR)) {
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
      } catch (e) {
        // silent
      }
    }
  }

  public getState(): DBState {
    return this.state;
  }

  public async getUsers(): Promise<User[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM users');
        return rows as User[];
      } catch (e) {
        console.error('MySQL getUsers fail:', e);
      }
    }
    return this.state.users;
  }

  public async getClients(): Promise<Client[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM clients ORDER BY createdAt DESC');
        return rows as Client[];
      } catch (e) {
        console.error('MySQL getClients fail:', e);
      }
    }
    return this.state.clients;
  }

  public async createClient(clientData: Omit<Client, 'id' | 'createdAt'>): Promise<Client> {
    const newClient: Client = {
      id: `cli-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      ...clientData
    };

    if (isMySQLConnected) {
      await query(`INSERT INTO clients (id, name, code, domain, criticality, status, sla_hours, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newClient.id, newClient.name, newClient.code, newClient.domain, newClient.criticality, newClient.status, newClient.sla_hours, newClient.createdAt]
      );
    }
    this.state.clients.unshift(newClient);
    return newClient;
  }

  public async deleteClient(clientId: string): Promise<boolean> {
    if (isMySQLConnected) {
      await query('DELETE FROM client_contacts WHERE clientId = ?', [clientId]);
      await query('DELETE FROM assets WHERE clientId = ?', [clientId]);
      await query('DELETE FROM incidents WHERE clientId = ?', [clientId]);
      await query('DELETE FROM clients WHERE id = ?', [clientId]);
    }
    this.state.clients = this.state.clients.filter(c => c.id !== clientId);
    this.state.assets = this.state.assets.filter(a => a.clientId !== clientId);
    this.state.incidents = this.state.incidents.filter(i => i.clientId !== clientId);
    return true;
  }

  public async getClientContacts(clientId: string): Promise<ClientContact[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM client_contacts WHERE clientId = ?', [clientId]);
        return rows as ClientContact[];
      } catch (e) {
        console.error('MySQL getClientContacts fail:', e);
      }
    }
    return this.state.client_contacts.filter(c => c.clientId === clientId);
  }

  public async getAssets(): Promise<Asset[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM assets ORDER BY hostname ASC');
        return rows as Asset[];
      } catch (e) {
        console.error('MySQL getAssets fail:', e);
      }
    }
    return this.state.assets;
  }

  public async createAsset(assetData: Omit<Asset, 'id' | 'lastDiscovery' | 'lastValidation'>): Promise<Asset> {
    const newAsset: Asset = {
      id: `ast-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      lastDiscovery: new Date().toISOString(),
      lastValidation: new Date().toISOString(),
      ...assetData
    };

    if (isMySQLConnected) {
      await query(`INSERT INTO assets (id, clientId, datacenter, environment, type, hostname, displayName, internalIp, externalIp, operatingSystem, version, criticality, status, lastDiscovery, lastValidation)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newAsset.id, newAsset.clientId, newAsset.datacenter, newAsset.environment, newAsset.type, newAsset.hostname, newAsset.displayName, newAsset.internalIp, newAsset.externalIp, newAsset.operatingSystem, newAsset.version, newAsset.criticality, newAsset.status, newAsset.lastDiscovery, newAsset.lastValidation]
      );
    }
    this.state.assets.push(newAsset);
    return newAsset;
  }

  public async deleteAsset(assetId: string): Promise<boolean> {
    if (isMySQLConnected) {
      await query('DELETE FROM asset_relationships WHERE sourceAssetId = ? OR targetAssetId = ?', [assetId, assetId]);
      await query('DELETE FROM diagnostic_runs WHERE assetId = ?', [assetId]);
      await query('DELETE FROM assets WHERE id = ?', [assetId]);
    }
    this.state.assets = this.state.assets.filter(a => a.id !== assetId);
    this.state.asset_relationships = this.state.asset_relationships.filter(r => r.sourceAssetId !== assetId && r.targetAssetId !== assetId);
    return true;
  }

  public async getAssetRelationships(): Promise<AssetRelationship[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM asset_relationships');
        return rows as AssetRelationship[];
      } catch (e) {
        console.error('MySQL getAssetRelationships fail:', e);
      }
    }
    return this.state.asset_relationships;
  }

  public async createAssetRelationship(relData: Omit<AssetRelationship, 'id'>): Promise<AssetRelationship> {
    const newRel: AssetRelationship = {
      id: `rel-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...relData
    };
    if (isMySQLConnected) {
      await query(`INSERT INTO asset_relationships (id, sourceAssetId, targetAssetId, type, origin, status)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [newRel.id, newRel.sourceAssetId, newRel.targetAssetId, newRel.type, newRel.origin, newRel.status]
      );
    }
    this.state.asset_relationships.push(newRel);
    return newRel;
  }

  public async deleteAssetRelationship(relId: string): Promise<boolean> {
    if (isMySQLConnected) {
      await query('DELETE FROM asset_relationships WHERE id = ?', [relId]);
    }
    this.state.asset_relationships = this.state.asset_relationships.filter(r => r.id !== relId);
    return true;
  }

  public async getKnowledgeDocs(): Promise<KnowledgeDocument[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM knowledge_documents ORDER BY updatedAt DESC');
        return rows.map((r: any) => ({
          ...r,
          tags: r.tags ? r.tags.split(',').map((t: string) => t.trim()) : []
        })) as KnowledgeDocument[];
      } catch (e) {
        console.error('MySQL getKnowledgeDocs fail:', e);
      }
    }
    return this.state.knowledge_documents;
  }

  public async createKnowledgeDoc(docData: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<KnowledgeDocument> {
    const newDoc: KnowledgeDocument = {
      id: `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      ...docData
    };

    if (isMySQLConnected) {
      await query(`INSERT INTO knowledge_documents (id, title, clientId, environment, type, category, criticality, tags, status, content, createdAt, updatedAt, version) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newDoc.id, newDoc.title, newDoc.clientId || null, newDoc.environment || null, newDoc.type, newDoc.category, newDoc.criticality, newDoc.tags.join(','), newDoc.status, newDoc.content, newDoc.createdAt, newDoc.updatedAt, newDoc.version]
      );
    }
    this.state.knowledge_documents.unshift(newDoc);
    return newDoc;
  }

  public async deleteKnowledgeDoc(docId: string): Promise<boolean> {
    if (isMySQLConnected) {
      await query('DELETE FROM knowledge_documents WHERE id = ?', [docId]);
    }
    this.state.knowledge_documents = this.state.knowledge_documents.filter(d => d.id !== docId);
    return true;
  }

  public async getConflicts(): Promise<KnowledgeConflict[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM knowledge_conflicts WHERE status = "OPEN"');
        return rows as KnowledgeConflict[];
      } catch (e) {
        console.error('MySQL getConflicts fail:', e);
      }
    }
    return this.state.knowledge_conflicts;
  }

  public async getRepositoryFiles(): Promise<RepositoryFile[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM repository_files ORDER BY uploadedAt DESC');
        return rows.map((r: any) => ({
          ...r,
          autoExtractedMetadata: r.autoExtractedMetadata ? JSON.parse(r.autoExtractedMetadata) : undefined
        })) as RepositoryFile[];
      } catch (e) {
        console.error('MySQL getRepositoryFiles fail:', e);
      }
    }
    return this.state.repository_files;
  }

  public async getIncidents(): Promise<Incident[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM incidents ORDER BY createdAt DESC');
        return rows as Incident[];
      } catch (e) {
        console.error('MySQL getIncidents fail:', e);
      }
    }
    return this.state.incidents;
  }

  public async createIncident(incidentData: Omit<Incident, 'id' | 'createdAt' | 'updatedAt'>): Promise<Incident> {
    const newInc: Incident = {
      id: `inc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...incidentData
    };

    if (isMySQLConnected) {
      await query(`INSERT INTO incidents (id, clientId, assetId, title, description, status, severity, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newInc.id, newInc.clientId, newInc.assetId || null, newInc.title, newInc.description, newInc.status, newInc.severity, newInc.createdAt, newInc.updatedAt]
      );
    }
    this.state.incidents.unshift(newInc);
    return newInc;
  }

  public async deleteIncident(incidentId: string): Promise<boolean> {
    if (isMySQLConnected) {
      await query('DELETE FROM incident_messages WHERE incidentId = ?', [incidentId]);
      await query('DELETE FROM diagnostic_runs WHERE incidentId = ?', [incidentId]);
      await query('DELETE FROM incidents WHERE id = ?', [incidentId]);
    }
    this.state.incidents = this.state.incidents.filter(i => i.id !== incidentId);
    this.state.incident_messages = this.state.incident_messages.filter(m => m.incidentId !== incidentId);
    this.state.diagnostic_runs = this.state.diagnostic_runs.filter(d => d.incidentId !== incidentId);
    return true;
  }

  public async getIncidentMessages(incidentId: string): Promise<IncidentMessage[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM incident_messages WHERE incidentId = ? ORDER BY createdAt ASC', [incidentId]);
        return rows as IncidentMessage[];
      } catch (e) {
        console.error('MySQL getIncidentMessages fail:', e);
      }
    }
    return this.state.incident_messages.filter(m => m.incidentId === incidentId);
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    if (isMySQLConnected) {
      try {
        const rows = await query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 100');
        return rows as AuditLog[];
      } catch (e) {
        console.error('MySQL getAuditLogs fail:', e);
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
        sql += ' ORDER BY timestamp DESC LIMIT 50';
        const rows = await query(sql, params);
        return rows as DiagnosticRun[];
      } catch (e) {
        console.error('MySQL getDiagnosticRuns fail:', e);
      }
    }
    if (incidentId) {
      return this.state.diagnostic_runs.filter(d => d.incidentId === incidentId);
    }
    return this.state.diagnostic_runs;
  }

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
        console.error('MySQL insertAuditLog fail:', e);
      }
    }

    this.state.audit_logs.unshift(newLog);
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
        console.error('MySQL insertIncidentMessage fail:', e);
      }
    }

    this.state.incident_messages.push(newMsg);
    return newMsg;
  }

  public async updateIncidentStatus(incidentId: string, status: Incident['status']): Promise<Incident | undefined> {
    const resolvedAt = status === 'RESOLVED' ? new Date().toISOString() : null;
    const updatedAt = new Date().toISOString();

    if (isMySQLConnected) {
      try {
        await query('UPDATE incidents SET status = ?, updatedAt = ?, resolvedAt = ? WHERE id = ?', 
          [status, updatedAt, resolvedAt, incidentId]
        );
      } catch (e) {
        console.error('MySQL updateIncidentStatus fail:', e);
      }
    }

    const incident = this.state.incidents.find(i => i.id === incidentId);
    if (incident) {
      incident.status = status;
      incident.updatedAt = updatedAt;
      if (status === 'RESOLVED') {
        incident.resolvedAt = resolvedAt || undefined;
      }
      return incident;
    }
    return undefined;
  }

  public async updateIncidentSeverity(incidentId: string, severity: Incident['severity']): Promise<Incident | undefined> {
    const updatedAt = new Date().toISOString();

    if (isMySQLConnected) {
      try {
        await query('UPDATE incidents SET severity = ?, updatedAt = ? WHERE id = ?', 
          [severity, updatedAt, incidentId]
        );
      } catch (e) {
        console.error('MySQL updateIncidentSeverity fail:', e);
      }
    }

    const incident = this.state.incidents.find(i => i.id === incidentId);
    if (incident) {
      incident.severity = severity;
      incident.updatedAt = updatedAt;
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
        console.error('MySQL insertDiagnosticRun fail:', e);
      }
    }

    this.state.diagnostic_runs.unshift(newRun);
    return newRun;
  }

  public async insertKnowledgeDoc(doc: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<KnowledgeDocument> {
    return this.createKnowledgeDoc(doc);
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
        console.error('MySQL insertKnowledgeConflict fail:', e);
      }
    }

    this.state.knowledge_conflicts.unshift(newConflict);
    return newConflict;
  }

  public async resolveKnowledgeConflict(conflictId: string, action: 'keep' | 'update' | 'reject'): Promise<boolean> {
    if (isMySQLConnected) {
      try {
        await query('UPDATE knowledge_conflicts SET status = "RESOLVED" WHERE id = ?', [conflictId]);
      } catch (e) {
        console.error('MySQL resolveKnowledgeConflict fail:', e);
      }
    }

    const conflict = this.state.knowledge_conflicts.find(c => c.id === conflictId);
    if (conflict) {
      conflict.status = 'RESOLVED';
    }
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
        console.error('MySQL insertRepositoryFile fail:', e);
      }
    }

    this.state.repository_files.push(newFile);
    return newFile;
  }

  public async approveIngestedMetadata(fileId: string): Promise<boolean> {
    const files = await this.getRepositoryFiles();
    const file = files.find(f => f.id === fileId);
    if (!file || !file.autoExtractedMetadata) return false;

    const metadata = file.autoExtractedMetadata;
    const existingClients = await this.getClients();

    // 1. Persist real clients extracted from file
    let targetClient: Client | null = null;
    for (const cName of metadata.clients) {
      let client = existingClients.find(c => c.name.toLowerCase() === cName.toLowerCase() || c.code.toLowerCase() === cName.toLowerCase());
      if (!client) {
        const code = cName.toUpperCase().replace(/\s+/g, '_');
        client = await this.createClient({
          name: cName,
          code,
          domain: `${code.toLowerCase()}.ibrcloud.com.br`,
          criticality: 'MEDIUM',
          status: 'ACTIVE',
          sla_hours: 4
        });
      }
      if (!targetClient) targetClient = client;
    }

    if (!targetClient && existingClients.length > 0) {
      targetClient = existingClients[0];
    }

    // 2. Persist real assets extracted from file
    const existingAssets = await this.getAssets();
    for (const newAsset of metadata.assets) {
      if (!newAsset.hostname) continue;
      const found = existingAssets.find(a => a.hostname.toLowerCase() === newAsset.hostname!.toLowerCase());
      if (!found && targetClient) {
        await this.createAsset({
          clientId: targetClient.id,
          datacenter: newAsset.datacenter || 'Infraestrutura Real',
          environment: newAsset.environment || 'PRODUCTION',
          type: newAsset.type || 'SERVER',
          hostname: newAsset.hostname,
          displayName: newAsset.displayName || newAsset.hostname,
          internalIp: newAsset.internalIp || '',
          externalIp: newAsset.externalIp || '',
          operatingSystem: newAsset.operatingSystem || 'Linux',
          version: newAsset.version || '',
          criticality: newAsset.criticality || 'MEDIUM',
          status: 'ACTIVE'
        });
      }
    }

    // 3. Mark file as PROCESSED in MySQL
    if (isMySQLConnected) {
      await query('UPDATE repository_files SET status = "PROCESSED" WHERE id = ?', [fileId]);
    }
    return true;
  }
}

export const db = new MySQLDatabaseManager();
export { isMySQLConnected };
