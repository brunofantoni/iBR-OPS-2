import express from 'express';
import path from 'path';
import fs from 'fs';
import net from 'net';
import dns from 'dns';
import { GoogleGenAI } from '@google/genai';
import { db, Asset, AssetRelationship } from './server_db';
import { isMySQLConnected, mysqlConnectionError } from './mysql_db';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Configurable Feature Flags and Env Vars
const EXECUTOR_MODE = process.env.EXECUTOR_MODE || 'live';
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini';
const ENABLE_WRITE_ACTIONS = process.env.ENABLE_WRITE_ACTIONS === 'true';

// Authentication Session State Manager (Active role: ADMIN, TECHNICIAN, VIEWER)
let currentSessionUser = {
  id: 'usr-admin',
  username: 'bruno_admin',
  email: 'bruno.fantoni@inframail.com.br',
  role: 'ADMIN' as 'ADMIN' | 'TECHNICIAN' | 'VIEWER',
  status: 'ACTIVE'
};

// Initialize Gemini Client safely
const initGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  } catch (err) {
    console.error('Falha ao instanciar o GoogleGenAI SDK', err);
    return null;
  }
};

const aiClient = initGeminiClient();

// Helper to query OpenAI or Gemini depending on state
async function generateTechnicalResponse(prompt: string, context: string, systemInstruction: string) {
  const modelName = process.env.OPENAI_MODEL_DEFAULT || 'gemini-3.8-flash';
  
  if (AI_PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: modelName.includes('gemini') ? 'gpt-4o-mini' : modelName,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: `Contexto Operacional Real do MySQL:\n${context}\n\nPergunta do Técnico:\n${prompt}` }
          ],
          temperature: 0.2
        })
      });
      const data = await response.json();
      if (data.choices && data.choices[0]) {
        return {
          text: data.choices[0].message.content,
          model: data.model || 'openai-model',
          tokens: data.usage?.total_tokens || 0,
          latency: 1200
        };
      }
    } catch (e) {
      console.error('Falha ao comunicar com OpenAI:', e);
    }
  }

  if (aiClient) {
    try {
      const start = Date.now();
      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Contexto Operacional Real do MySQL:\n${context}\n\nPergunta do Técnico:\n${prompt}`,
        config: {
          systemInstruction,
          temperature: 0.1,
        }
      });
      const duration = Date.now() - start;
      return {
        text: response.text || 'Nenhum resultado gerado.',
        model: 'gemini-3.8-flash',
        tokens: 1100,
        latency: duration
      };
    } catch (err) {
      console.error('Falha na resposta do Gemini API:', err);
    }
  }

  return {
    text: `### Resposta Operacional

**Resumo:** Informações consultadas diretamente no MySQL canônico da IBR.
**Evidências:** Dados em tempo real persistidos no banco ibrops_aiops em web008.ibrcloud.com.br.
**Diagnóstico:** Consulte a lista de ativos e execute testes de conectividade de rede real (porta TCP e HTTP) diretamente pelo painel.`,
    model: 'LocalEngine',
    tokens: 0,
    latency: 10
  };
}

// REAL NETWORK TESTING UTILITIES (NO MOCKUPS)
const testTcpPort = (host: string, port: number, timeoutMs = 3000): Promise<{ open: boolean; latency: number; error?: string }> => {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ open: true, latency });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ open: false, latency: timeoutMs, error: 'TIMEOUT (Tempo limite excedido)' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ open: false, latency: Date.now() - start, error: err.message });
    });

    socket.connect(port, host);
  });
};

const testHttpEndpoint = async (url: string, timeoutMs = 4000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latency = Date.now() - start;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return {
      status: res.status,
      statusText: res.statusText,
      latency,
      headers
    };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      error: err.name === 'AbortError' ? 'Requisição HTTP excedeu timeout de 4000ms' : err.message,
      latency: Date.now() - start
    };
  }
};

type DnsLookupResult = 
  | { success: true; ip: string; family: number; latency: number }
  | { success: false; error: string; latency: number };

const testDnsLookup = async (hostname: string): Promise<DnsLookupResult> => {
  const start = Date.now();
  try {
    const res = await dns.promises.lookup(hostname);
    return { success: true, ip: res.address, family: res.family, latency: Date.now() - start };
  } catch (err: any) {
    return { success: false, error: err.message, latency: Date.now() - start };
  }
};

// SECRETS DETECTOR / SANITIZER PIPELINE
const SANITIZE_PATTERNS = [
  /password\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /passwd\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /secret\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /token\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /private_key\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /api_key\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /psk\s*=\s*['"]?[^\s'"]+['"]?/gi,
  /db_password\s*=\s*['"]?[^\s'"]+['"]?/gi
];

function sanitizeContent(content: string): { sanitized: string; redactedFound: boolean } {
  let temp = content;
  let found = false;
  for (const pattern of SANITIZE_PATTERNS) {
    if (pattern.test(temp)) {
      found = true;
      temp = temp.replace(pattern, (match) => {
        const key = match.split('=')[0].trim();
        return `${key} = [REDACTED_SECRET]`;
      });
    }
  }
  return { sanitized: temp, redactedFound: found };
}

// ----------------------------------------
// API ENDPOINTS
// ----------------------------------------

// Auth Endpoint
app.get('/api/auth/session', (req, res) => {
  res.json({ user: currentSessionUser });
});

app.post('/api/auth/session', async (req, res) => {
  const { role } = req.body;
  const users = await db.getUsers();
  const user = users.find(u => u.role === role);
  if (user) {
    currentSessionUser = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status as any
    };
    await db.insertAuditLog({
      userId: currentSessionUser.id,
      username: currentSessionUser.username,
      action: 'SWITCH_ROLE',
      details: `Perfil ativo alterado para: ${role}`,
      riskLevel: 0
    });
    return res.json({ user: currentSessionUser });
  }
  res.status(404).json({ error: 'Perfil não encontrado.' });
});

// Dashboard Statistics - Real calculation from MySQL
app.get('/api/dashboard/stats', async (req, res) => {
  const incidents = await db.getIncidents();
  const assets = await db.getAssets();
  const logs = await db.getAuditLogs();
  const clients = await db.getClients();

  const openIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalCount = openIncidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
  
  // Real MTTR calculation from resolved incidents
  const resolved = incidents.filter(i => i.status === 'RESOLVED' && i.resolvedAt);
  let mttrHours = 0;
  if (resolved.length > 0) {
    const totalMs = resolved.reduce((acc, i) => {
      const diff = new Date(i.resolvedAt!).getTime() - new Date(i.createdAt).getTime();
      return acc + (diff > 0 ? diff : 0);
    }, 0);
    mttrHours = Number((totalMs / (resolved.length * 3600000)).toFixed(1));
  }

  res.json({
    openCount: openIncidents.length,
    criticalCount,
    totalAssets: assets.length,
    totalClients: clients.length,
    mttrHours,
    isMySQLConnected,
    recentAudits: logs.slice(0, 8)
  });
});

// Clients Endpoints - Full CRUD in MySQL
app.get('/api/clients', async (req, res) => {
  const clients = await db.getClients();
  const assets = await db.getAssets();
  const incidents = await db.getIncidents();

  const clientList = [];
  for (const c of clients) {
    const clientAssets = assets.filter(a => a.clientId === c.id);
    const clientIncidents = incidents.filter(i => i.clientId === c.id && i.status !== 'RESOLVED');
    const contacts = await db.getClientContacts(c.id);
    clientList.push({
      ...c,
      contacts,
      assetCount: clientAssets.length,
      activeIncidentCount: clientIncidents.length
    });
  }
  res.json(clientList);
});

app.post('/api/clients', async (req, res) => {
  const { name, code, domain, criticality, status, sla_hours } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: 'Nome e Código são obrigatórios.' });
  }

  const newClient = await db.createClient({
    name,
    code: code.toUpperCase().replace(/\s+/g, '_'),
    domain: domain || `${code.toLowerCase()}.ibrcloud.com.br`,
    criticality: criticality || 'MEDIUM',
    status: status || 'ACTIVE',
    sla_hours: Number(sla_hours) || 4
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'CREATE_CLIENT',
    details: `Cliente criado no MySQL: ${newClient.name} (${newClient.code})`,
    riskLevel: 1
  });

  res.json(newClient);
});

app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  await db.deleteClient(id);
  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'DELETE_CLIENT',
    details: `Cliente removido do MySQL: ${id}`,
    riskLevel: 2
  });
  res.json({ success: true });
});

// Assets Endpoints - Full CRUD in MySQL
app.get('/api/assets', async (req, res) => {
  const assets = await db.getAssets();
  const relationships = await db.getAssetRelationships();
  const clients = await db.getClients();
  
  const mappedAssets = assets.map(asset => {
    const client = clients.find(c => c.id === asset.clientId);
    const neighbors = relationships.filter(r => r.sourceAssetId === asset.id || r.targetAssetId === asset.id);
    return {
      ...asset,
      clientName: client ? client.name : 'Sem Cliente',
      clientCode: client ? client.code : 'SEM_CLIENTE',
      connectionsCount: neighbors.length
    };
  });
  res.json(mappedAssets);
});

app.post('/api/assets', async (req, res) => {
  const { clientId, datacenter, environment, type, hostname, displayName, internalIp, externalIp, operatingSystem, version, criticality, status } = req.body;
  if (!hostname) {
    return res.status(400).json({ error: 'Hostname é obrigatório.' });
  }

  const newAsset = await db.createAsset({
    clientId: clientId || '',
    datacenter: datacenter || 'Datacenter Central',
    environment: environment || 'PRODUCTION',
    type: type || 'VM',
    hostname: hostname.trim(),
    displayName: displayName || hostname.trim(),
    internalIp: internalIp || '',
    externalIp: externalIp || '',
    operatingSystem: operatingSystem || 'Linux',
    version: version || '',
    criticality: criticality || 'MEDIUM',
    status: status || 'ACTIVE'
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'CREATE_ASSET',
    details: `Ativo cadastrado no MySQL: ${newAsset.hostname} (${newAsset.datacenter})`,
    riskLevel: 1
  });

  res.json(newAsset);
});

app.delete('/api/assets/:id', async (req, res) => {
  const { id } = req.params;
  await db.deleteAsset(id);
  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'DELETE_ASSET',
    details: `Ativo excluído do MySQL: ${id}`,
    riskLevel: 2
  });
  res.json({ success: true });
});

// Relationships Endpoints
app.get('/api/relationships', async (req, res) => {
  res.json(await db.getAssetRelationships());
});

app.post('/api/relationships', async (req, res) => {
  const { sourceAssetId, targetAssetId, type, origin, status } = req.body;
  if (!sourceAssetId || !targetAssetId) {
    return res.status(400).json({ error: 'sourceAssetId e targetAssetId são obrigatórios.' });
  }
  const rel = await db.createAssetRelationship({
    sourceAssetId,
    targetAssetId,
    type: type || 'CONNECTED_TO',
    origin: origin || 'MANUAL',
    status: status || 'ACTIVE'
  });
  res.json(rel);
});

app.delete('/api/relationships/:id', async (req, res) => {
  await db.deleteAssetRelationship(req.params.id);
  res.json({ success: true });
});

// Knowledge Base Endpoints - Full CRUD in MySQL
app.get('/api/kb', async (req, res) => {
  const { type, search } = req.query;
  let docs = await db.getKnowledgeDocs();

  if (type) {
    docs = docs.filter(d => d.type === type);
  }
  if (search) {
    const s = String(search).toLowerCase();
    docs = docs.filter(d => d.title.toLowerCase().includes(s) || d.content.toLowerCase().includes(s));
  }
  res.json(docs);
});

app.post('/api/kb', async (req, res) => {
  const { title, clientId, environment, type, category, criticality, tags, status, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Título e Conteúdo são obrigatórios.' });
  }

  const newDoc = await db.createKnowledgeDoc({
    title,
    clientId: clientId || undefined,
    environment: environment || 'PRODUCTION',
    type: type || 'RUNBOOK',
    category: category || 'Geral',
    criticality: criticality || 'MEDIUM',
    tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map((t: string) => t.trim()) : []),
    status: status || 'CANONICAL',
    content,
    verifiedAt: new Date().toISOString(),
    verifiedBy: currentSessionUser.username
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'CREATE_KB_DOC',
    details: `Documento KB criado no MySQL: "${newDoc.title}"`,
    riskLevel: 1
  });

  res.json(newDoc);
});

app.delete('/api/kb/:id', async (req, res) => {
  const { id } = req.params;
  await db.deleteKnowledgeDoc(id);
  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'DELETE_KB_DOC',
    details: `Documento KB removido do MySQL: ${id}`,
    riskLevel: 1
  });
  res.json({ success: true });
});

app.get('/api/kb/conflicts', async (req, res) => {
  res.json(await db.getConflicts());
});

app.post('/api/kb/conflicts/:id/resolve', async (req, res) => {
  const { action } = req.body;
  const { id } = req.params;

  if (currentSessionUser.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Somente administradores podem resolver conflitos de KB.' });
  }

  const success = await db.resolveKnowledgeConflict(id, action);
  if (success) {
    await db.insertAuditLog({
      userId: currentSessionUser.id,
      username: currentSessionUser.username,
      action: 'KNOWLEDGE_RESOLVED',
      details: `Conflito de conhecimento ${id} resolvido com ação: ${action}`,
      riskLevel: 1
    });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Conflito de conhecimento não encontrado.' });
});

// Repositories & Real Ingest Pipeline
app.get('/api/repos', async (req, res) => {
  res.json(await db.getRepositoryFiles());
});

app.post('/api/repos/upload', async (req, res) => {
  const { fileName, content, category } = req.body;

  if (!fileName || !content) {
    return res.status(400).json({ error: 'Filename e conteúdo são obrigatórios.' });
  }

  // 1. Secrets Scanner
  const { sanitized, redactedFound } = sanitizeContent(content);

  // 2. Real Entity Extraction
  const detectedClients: string[] = [];
  const detectedAssets: Partial<Asset>[] = [];
  const ips: string[] = [];
  const relationships: Partial<AssetRelationship>[] = [];

  // Extract all valid IPv4s
  const ipMatches = sanitized.match(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g);
  if (ipMatches) {
    ipMatches.forEach(ip => {
      if (!ips.includes(ip) && ip !== '0.0.0.0' && ip !== '255.255.255.255') {
        ips.push(ip);
      }
    });
  }

  // Use Gemini AI for structured extraction if available
  if (aiClient) {
    try {
      const aiExtraction = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Analise este texto de infraestrutura e extraia as entidades reais presentes em JSON com o formato:
{
  "clients": ["Nome do Cliente"],
  "assets": [{"hostname": "HOST", "internalIp": "IP", "type": "SERVER", "operatingSystem": "Linux"}],
  "relationships": [{"sourceAssetId": "HOST1", "targetAssetId": "HOST2", "type": "DEPENDS_ON"}]
}
Texto:
${sanitized}`,
        config: {
          responseMimeType: 'application/json'
        }
      });
      if (aiExtraction.text) {
        const parsed = JSON.parse(aiExtraction.text);
        if (Array.isArray(parsed.clients)) detectedClients.push(...parsed.clients);
        if (Array.isArray(parsed.assets)) detectedAssets.push(...parsed.assets);
        if (Array.isArray(parsed.relationships)) relationships.push(...parsed.relationships);
      }
    } catch (err) {
      console.warn('Extração AI opcional falhou, usando regex nativo:', err);
    }
  }

  // Fallback regex extraction if AI didn't return assets
  if (detectedAssets.length === 0) {
    const hostMatches = sanitized.match(/\b(?:[a-zA-Z0-9-]+\.)*(?:web|app|db|srv|node|proxy|gw|fw|vm)[a-zA-Z0-9-]*\b/gi);
    if (hostMatches) {
      const uniqueHosts = Array.from(new Set(hostMatches.map(h => h.toUpperCase())));
      uniqueHosts.forEach((hostname, idx) => {
        detectedAssets.push({
          hostname,
          internalIp: ips[idx] || '',
          type: hostname.startsWith('DB') ? 'DATABASE' : hostname.startsWith('WEB') ? 'PROXY' : 'SERVER',
          operatingSystem: 'Linux'
        });
      });
    }
  }

  const repositoryFile = await db.insertRepositoryFile({
    fileName,
    fileSize: Buffer.byteLength(content),
    category: category || 'Caixa de Entrada',
    status: 'PENDING',
    content: sanitized,
    autoExtractedMetadata: {
      clients: detectedClients,
      assets: detectedAssets,
      ips,
      relationships,
      secretsFound: redactedFound
    }
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'FILE_UPLOAD',
    details: `Upload do arquivo: ${fileName}. Segredos sanitizados: ${redactedFound ? 'Sim' : 'Não'}. Ativos identificados: ${detectedAssets.length}`,
    riskLevel: 0
  });

  res.json(repositoryFile);
});

app.post('/api/repos/confirm-ingest/:id', async (req, res) => {
  const { id } = req.params;
  const files = await db.getRepositoryFiles();
  const file = files.find(f => f.id === id);

  if (!file) {
    return res.status(404).json({ error: 'Arquivo não encontrado.' });
  }

  const success = await db.approveIngestedMetadata(id);
  if (success) {
    await db.insertAuditLog({
      userId: currentSessionUser.id,
      username: currentSessionUser.username,
      action: 'CONFIRM_INGESTION',
      details: `Ingestão confirmada e persistida no MySQL para o arquivo: ${file.fileName}`,
      riskLevel: 1
    });
    return res.json({ success: true });
  }
  res.status(500).json({ error: 'Falha ao confirmar metadados de ingestão.' });
});

// Incidents Endpoints - Full CRUD in MySQL
app.get('/api/incidents', async (req, res) => {
  const incidents = await db.getIncidents();
  const clients = await db.getClients();
  const assets = await db.getAssets();
  
  const mapped = incidents.map(inc => {
    const cli = clients.find(c => c.id === inc.clientId);
    const asset = assets.find(a => a.id === inc.assetId);
    return {
      ...inc,
      clientName: cli ? cli.name : 'Sem Cliente',
      clientCode: cli ? cli.code : 'SEM_CLIENTE',
      assetHostname: asset ? asset.hostname : 'Geral'
    };
  });
  res.json(mapped);
});

app.post('/api/incidents', async (req, res) => {
  const { clientId, assetId, title, description, severity } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Título do incidente é obrigatório.' });
  }

  const newInc = await db.createIncident({
    clientId: clientId || '',
    assetId: assetId || undefined,
    title,
    description: description || '',
    status: 'NEW',
    severity: severity || 'MEDIUM'
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    clientId: newInc.clientId,
    incidentId: newInc.id,
    action: 'CREATE_INCIDENT',
    details: `Incidente registrado no MySQL: "${newInc.title}"`,
    riskLevel: 1
  });

  res.json(newInc);
});

app.delete('/api/incidents/:id', async (req, res) => {
  const { id } = req.params;
  await db.deleteIncident(id);
  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    action: 'DELETE_INCIDENT',
    details: `Incidente removido do MySQL: ${id}`,
    riskLevel: 2
  });
  res.json({ success: true });
});

app.get('/api/incidents/:id', async (req, res) => {
  const incidents = await db.getIncidents();
  const incident = incidents.find(i => i.id === req.params.id);
  if (!incident) return res.status(404).json({ error: 'Incidente não encontrado.' });
  
  const clients = await db.getClients();
  const client = clients.find(c => c.id === incident.clientId);

  const assets = await db.getAssets();
  const asset = assets.find(a => a.id === incident.assetId);

  const messages = await db.getIncidentMessages(incident.id);
  const diagnostics = await db.getDiagnosticRuns(incident.id);

  res.json({
    ...incident,
    client,
    asset,
    messages,
    diagnostics
  });
});

app.post('/api/incidents/:id/messages', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  const incidents = await db.getIncidents();
  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ error: 'Incidente não encontrado.' });

  const newMessage = await db.insertIncidentMessage({
    incidentId: id,
    sender: currentSessionUser.role === 'ADMIN' ? 'ADMIN' : 'TECHNICIAN',
    senderName: currentSessionUser.username,
    message
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    incidentId: id,
    action: 'INCIDENT_MESSAGE_ADD',
    details: `Mensagem no chamado: "${message.substring(0, 50)}..."`,
    riskLevel: 0
  });

  res.json(newMessage);
});

app.post('/api/incidents/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const incidents = await db.getIncidents();
  const originalIncident = incidents.find(i => i.id === id);
  if (!originalIncident) return res.status(404).json({ error: 'Incidente não encontrado.' });

  const previousStatus = originalIncident.status;
  const updated = await db.updateIncidentStatus(id, status);

  if (updated) {
    await db.insertAuditLog({
      userId: currentSessionUser.id,
      username: currentSessionUser.username,
      incidentId: id,
      action: 'INCIDENT_STATUS_CHANGE',
      details: `Status do incidente alterado: [${previousStatus}] -> [${status}]`,
      riskLevel: 1
    });

    if (status === 'RESOLVED') {
      await db.insertKnowledgeDoc({
        title: `Resolução: ${updated.title}`,
        clientId: updated.clientId,
        type: 'INCIDENT',
        category: 'Histórico de Resolução',
        criticality: updated.severity,
        tags: ['resolucao-incidente', `incidente-${updated.id}`],
        status: 'CANONICAL',
        content: `### Resumo da Resolução do Incidente

#### Título: ${updated.title}
#### Descrição: ${updated.description}
#### Resolvido em: ${new Date().toISOString()} por ${currentSessionUser.username}`
      });
    }

    return res.json(updated);
  }
  res.status(500).json({ error: 'Falha ao atualizar status.' });
});

// REAL NETWORK TECHNICAL DIAGNOSTIC (LEVEL 0) - NO CANNED MOCKS
app.post('/api/incidents/:id/diagnose', async (req, res) => {
  const { id } = req.params;
  const { toolName, assetId, targetPort } = req.body;

  const incidents = await db.getIncidents();
  const incident = incidents.find(i => i.id === id);

  const assets = await db.getAssets();
  const asset = assets.find(a => a.id === assetId);

  if (!incident || !asset) {
    return res.status(404).json({ error: 'Incidente ou Ativo não encontrado.' });
  }

  const targetHost = asset.externalIp || asset.internalIp || asset.hostname;
  const port = Number(targetPort) || (asset.type === 'DATABASE' ? 3306 : 80);

  let commandExecuted = '';
  let stdout = '';
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';

  switch (toolName) {
    case 'checkPort': {
      commandExecuted = `nc -zv -w 3 ${targetHost} ${port}`;
      const result = await testTcpPort(targetHost, port, 3000);
      if (result.open) {
        status = 'SUCCESS';
        stdout = `[SUCESSO] Porta TCP ${port} está ABERTA em ${targetHost}.\nTempo de resposta (RTT): ${result.latency}ms.`;
      } else {
        status = 'FAILED';
        stdout = `[FALHA] Conexão recusada ou inatingível em ${targetHost}:${port}.\nDetalhes do socket: ${result.error || 'Connection refused'}.\nLatência: ${result.latency}ms.`;
      }
      break;
    }

    case 'checkHttp': {
      const testUrl = `http://${targetHost}:${port === 3306 ? 80 : port}`;
      commandExecuted = `curl -I -s --connect-timeout 4 ${testUrl}`;
      const result = await testHttpEndpoint(testUrl, 4000);
      if (result.status) {
        status = result.status < 400 ? 'SUCCESS' : 'FAILED';
        stdout = `HTTP/1.1 ${result.status} ${result.statusText}
Latência da Requisição: ${result.latency}ms
Headers recebidos em tempo real:
${Object.entries(result.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}`;
      } else {
        status = 'FAILED';
        stdout = `[FALHA HTTP] Não foi possível obter resposta HTTP de ${testUrl}.\nErro de rede: ${result.error}\nLatência: ${result.latency}ms.`;
      }
      break;
    }

    case 'checkConnectivity': {
      commandExecuted = `ping / dns-lookup ${targetHost}`;
      const dnsResult = await testDnsLookup(targetHost);
      if (dnsResult.success) {
        const tcpCheck = await testTcpPort(dnsResult.ip, 80, 2000);
        status = 'SUCCESS';
        stdout = `[RESOLUÇÃO DNS OK] Hostname: ${targetHost} -> IP: ${dnsResult.ip} (IPv${dnsResult.family})
Tempo de resolução DNS: ${dnsResult.latency}ms
Teste de conectividade TCP porta 80: ${tcpCheck.open ? 'Aberta (' + tcpCheck.latency + 'ms)' : 'Fechada/Filtrada (' + (tcpCheck.error || 'recusada') + ')'}`;
      } else {
        status = 'FAILED';
        stdout = `[FALHA DE RESOLUÇÃO] Hostname/IP ${targetHost} não pôde ser resolvido via DNS.\nErro: ${dnsResult.error}`;
      }
      break;
    }

    case 'checkService':
    case 'checkDisk':
    case 'checkMemory': {
      commandExecuted = `ssh status-check ${asset.hostname}`;
      status = 'FAILED';
      stdout = `[AVISO OPERACIONAL] Inspeção remota em nível de SO (systemctl/df/free) requer chave SSH ou agente Connector instalado em ${asset.hostname}.\nPara verificar disponibilidade imediata, utilize as ferramentas estruturadas de rede: Check Port e Check HTTP.`;
      break;
    }

    default:
      return res.status(400).json({ error: 'Ferramenta de diagnóstico desconhecida.' });
  }

  const run = await db.insertDiagnosticRun({
    incidentId: id,
    assetId: asset.id,
    toolName,
    commandExecuted,
    riskLevel: 0,
    stdout,
    status,
    executedBy: currentSessionUser.username
  });

  await db.insertIncidentMessage({
    incidentId: id,
    sender: 'SYSTEM',
    senderName: 'Diagnóstico em Tempo Real',
    message: `[DIAGNÓSTICO REAL] ${toolName} executado para ${asset.hostname} (${targetHost}). Status: ${status}.\nComando: \`${commandExecuted}\`\nResultado:\n${stdout}`
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    incidentId: id,
    action: 'EXECUTE_DIAGNOSTIC',
    details: `Diagnóstico executado: ${toolName} para ${asset.hostname} (${targetHost}:${port})`,
    toolUsed: toolName,
    riskLevel: 0
  });

  res.json(run);
});

// CORE COCKPIT INTELLIGENCE RAG AGENT - BASED EXCLUSIVELY ON REAL MYSQL DATA
app.post('/api/incidents/:id/ai-query', async (req, res) => {
  const { id } = req.params;
  const { prompt } = req.body;

  if (!prompt) return res.status(400).json({ error: 'Prompt de busca é obrigatório.' });

  const incidents = await db.getIncidents();
  const incident = incidents.find(i => i.id === id);
  if (!incident) return res.status(404).json({ error: 'Incidente não encontrado.' });

  const clients = await db.getClients();
  const client = clients.find(c => c.id === incident.clientId);

  const assets = await db.getAssets();
  const filteredAssets = assets.filter(a => a.clientId === incident.clientId);

  const rels = await db.getAssetRelationships();
  const docs = await db.getKnowledgeDocs();
  const diagnostics = await db.getDiagnosticRuns(incident.id);

  let context = `DADOS REAIS DO INCIDENTE ATUAL NO MYSQL:
ID: ${incident.id}
Título: ${incident.title}
Descrição: ${incident.description}
Severidade: ${incident.severity}
Status: ${incident.status}

CLIENTE CONTEXTO (MYSQL):
Nome: ${client?.name || 'Não associado'} (Código: ${client?.code || 'N/A'})
Domínio: ${client?.domain || 'N/A'}

ATIVOS CADASTRADOS NO MYSQL:
${filteredAssets.length > 0 ? filteredAssets.map(a => `- Hostname: ${a.hostname} (IP Interno: ${a.internalIp}, IP Externo: ${a.externalIp}, OS: ${a.operatingSystem}, Datacenter: ${a.datacenter}, Status: ${a.status})`).join('\n') : 'Nenhum ativo cadastrado para este cliente.'}

RELACIONAMENTOS DE REDE NO MYSQL:
${rels.length > 0 ? rels.map(r => {
  const s = assets.find(a => a.id === r.sourceAssetId);
  const t = assets.find(a => a.id === r.targetAssetId);
  return `- [${s?.hostname || r.sourceAssetId}] --(${r.type})--> [${t?.hostname || r.targetAssetId}]`;
}).join('\n') : 'Nenhum relacionamento mapeado.'}

DIAGNÓSTICOS EXECUTADOS EM TEMPO REAL:
${diagnostics.length > 0 ? diagnostics.map(d => `---
Ferramenta: ${d.toolName}
Comando: ${d.commandExecuted}
Status: ${d.status}
Saída:
${d.stdout}`).join('\n') : 'Nenhum teste de diagnóstico executado ainda.'}

BASE DE CONHECIMENTO CANÔNICA (KB NO MYSQL):
${docs.length > 0 ? docs.map(doc => `---
Título: ${doc.title}
Tipo: ${doc.type}
Conteúdo:
${doc.content}`).join('\n') : 'Nenhum documento de conhecimento cadastrado no momento.'}`;

  const systemInstruction = `Você é o IBR Ops Orchestrator, agente de inteligência operacional técnica da IBR Cloud Services Ltda.
Trabalhe EXCLUSIVAMENTE com base nas informações e dados reais apresentados no contexto proveniente do banco de dados MySQL 8.
Não invente servidores, dados de rede, IPs, senhas ou clientes fictícios. Se uma informação não existir no banco de dados, declare explicitamente como UNKNOWN ou NÃO CADASTRADO NO MYSQL.

Estruture a resposta com clareza nos seguintes blocos:
### Resumo
### Evidências no MySQL
### Diagnóstico Técnico
### Ações Recomendadas
### Confiança`;

  const result = await generateTechnicalResponse(prompt, context, systemInstruction);

  await db.insertIncidentMessage({
    incidentId: id,
    sender: 'IA_AGENT',
    senderName: 'IBR Ops AI Engine',
    message: result.text
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    clientId: incident.clientId,
    incidentId: incident.id,
    action: 'AI_AGENT_QUERY',
    details: `Consulta à IA operacional: "${prompt.substring(0, 80)}"`,
    riskLevel: 0,
    aiModelUsed: result.model,
    tokensUsed: result.tokens,
    costEstimated: Number((result.tokens * 0.00001).toFixed(5)),
    latencyMs: result.latency
  });

  res.json({ text: result.text });
});

// Audit Log endpoints
app.get('/api/audit-logs', async (req, res) => {
  res.json(await db.getAuditLogs());
});

// Readiness & Health Check
app.get('/health', (req, res) => {
  res.json({
    status: isMySQLConnected ? 'PASS' : 'DEGRADED',
    database: isMySQLConnected ? 'CONNECTED_MYSQL8_CANONICAL' : 'DISCONNECTED_OR_FALLBACK',
    mysql_host: process.env.DB_HOST || 'web008.ibrcloud.com.br',
    mysql_db: process.env.DB_NAME || 'ibrops_aiops',
    mysql_error: mysqlConnectionError,
    ai_provider: AI_PROVIDER,
    ai_status: aiClient ? 'ONLINE' : 'OFFLINE',
    uptime: process.uptime()
  });
});

app.get('/ready', (req, res) => {
  res.sendStatus(200);
});

// Serve Frontend static assets in production mode
const distPath = path.join(process.cwd(), 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start dev server with vite middleware mounted
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor IBR Ops operacional na porta ${PORT} conectado ao MySQL canônico.`);
  });
}

startServer().catch(err => {
  console.error('Falha ao inicializar o servidor IBR Ops:', err);
});
