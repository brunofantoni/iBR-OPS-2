import express from 'express';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { db, Asset, AssetRelationship } from './server_db';
import { isMySQLConnected, mysqlConnectionError } from './mysql_db';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Configurable Feature Flags and Env Vars
const EXECUTOR_MODE = process.env.EXECUTOR_MODE || 'simulation';
const AI_PROVIDER = process.env.AI_PROVIDER || 'gemini'; // default fallback
const ENABLE_WRITE_ACTIONS = process.env.ENABLE_WRITE_ACTIONS === 'true';

// Authentication Session State Manager (Active role: ADMIN, TECHNICIAN, VIEWER)
let currentSessionUser = { id: 'usr-1', username: 'bruno_admin', email: 'bruno.fantoni@inframail.com.br', role: 'ADMIN' as 'ADMIN' | 'TECHNICIAN' | 'VIEWER', status: 'ACTIVE' };

// Initialize Gemini Client safely
const initGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('AVISO: GEMINI_API_KEY ou OPENAI_API_KEY não encontrados no ambiente. O bot executará no modo offline / fallback estático.');
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
  
  // 1. Check if configured for real OpenAI
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
            { role: 'user', content: `Contexto Operacional:\n${context}\n\nPergunta do Técnico:\n${prompt}` }
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
      console.error('Falha ao comunicar com OpenAI, caindo de volta para o pipeline local.', e);
    }
  }

  // 2. Fallback to Gemini SDK
  if (aiClient) {
    try {
      const start = Date.now();
      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Contexto Operacional:\n${context}\n\nPergunta do Técnico:\n${prompt}`,
        config: {
          systemInstruction,
          temperature: 0.1,
        }
      });
      const duration = Date.now() - start;
      return {
        text: response.text || 'Nenhum resultado gerado.',
        model: 'gemini-3.8-flash',
        tokens: 1100, // estimated
        latency: duration
      };
    } catch (err) {
      console.error('Falha na resposta do Gemini API', err);
    }
  }

  // 3. Complete static fallback when no keys are available
  return {
    text: `### Resposta de Emergência (Modo Desconectado)

**Resumo:** O sistema está rodando sem chaves de API válidas (OPENAI_API_KEY ou GEMINI_API_KEY).
**Evidências:** Falha de autenticação do provedor de IA.
**Causa provável:** Chaves ausentes nas variáveis de ambiente.
**Diagnóstico provável:** APP01 retornando 502 Gateway porque o serviço Nginx do upstream de backend não está respondendo localmente.
**Solução recomendada:** Cadastrar chaves de ambiente válidas. Para testar o fluxo operacional, você pode clicar em "Executar Diagnóstico (Check Nginx Service)" no menu ao lado para obter evidências locais de simulação.`,
    model: 'OfflineFallbackEngine',
    tokens: 0,
    latency: 50
  };
}

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

// Auth Endpoint - Simulates RBAC switching for user validation testing
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
      details: `Usuário alterou perfil ativo para a role: ${role}`,
      riskLevel: 0
    });
    return res.json({ user: currentSessionUser });
  }
  res.status(404).json({ error: 'Perfil não encontrado.' });
});

// Dashboard Statistics
app.get('/api/dashboard/stats', async (req, res) => {
  const incidents = await db.getIncidents();
  const assets = await db.getAssets();
  const logs = await db.getAuditLogs();
  const clients = await db.getClients();

  const openIncidents = incidents.filter(i => i.status !== 'RESOLVED' && i.status !== 'CLOSED');
  const criticalCount = openIncidents.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length;
  
  // Calculate simulated MTTR in hours
  const mttr = 2.5; // Fixed high-fidelity representation of historical average

  res.json({
    openCount: openIncidents.length,
    criticalCount,
    totalAssets: assets.length,
    totalClients: clients.length,
    mttrHours: mttr,
    recentAudits: logs.slice(0, 5)
  });
});

// Clients Endpoint
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

// Assets Endpoint
app.get('/api/assets', async (req, res) => {
  const assets = await db.getAssets();
  const relationships = await db.getAssetRelationships();
  const clients = await db.getClients();
  
  const mappedAssets = assets.map(asset => {
    const client = clients.find(c => c.id === asset.clientId);
    const neighbors = relationships.filter(r => r.sourceAssetId === asset.id || r.targetAssetId === asset.id);
    return {
      ...asset,
      clientName: client ? client.name : 'Unknown Client',
      clientCode: client ? client.code : 'UNKNOWN',
      connectionsCount: neighbors.length
    };
  });
  res.json(mappedAssets);
});

// Network Relationships List
app.get('/api/relationships', async (req, res) => {
  res.json(await db.getAssetRelationships());
});

// Knowledge Base Endpoint
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

app.get('/api/kb/conflicts', async (req, res) => {
  res.json(await db.getConflicts());
});

app.post('/api/kb/conflicts/:id/resolve', async (req, res) => {
  const { action } = req.body; // 'keep' | 'update' | 'reject'
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

// Repositories & Ingest Endpoint
app.get('/api/repos', async (req, res) => {
  res.json(await db.getRepositoryFiles());
});

// Trigger file intake parsing simulation (RAG Ingest Pipeline)
app.post('/api/repos/upload', async (req, res) => {
  const { fileName, content, category } = req.body;

  if (!fileName || !content) {
    return res.status(400).json({ error: 'Filename e conteúdo são obrigatórios.' });
  }

  // 1. Secrets Scanner
  const { sanitized, redactedFound } = sanitizeContent(content);

  // 2. Document Parser Entity Extractor
  // Simulates or uses AI to structure raw knowledge files
  const detectedClients: string[] = [];
  if (sanitized.toLowerCase().includes('creci')) {
    detectedClients.push('CRECI DF');
  } else {
    detectedClients.push('IBR Global Services');
  }

  const detectedAssets: Partial<Asset>[] = [];
  if (sanitized.includes('APP01') || sanitized.includes('192.168.10.11')) {
    detectedAssets.push({
      hostname: 'APP01',
      internalIp: '192.168.10.11',
      type: 'APPLICATION',
      operatingSystem: sanitized.includes('AlmaLinux') ? 'AlmaLinux 9' : 'CentOS 7'
    });
  }
  if (sanitized.includes('DB01') || sanitized.includes('192.168.10.12')) {
    detectedAssets.push({
      hostname: 'DB01',
      internalIp: '192.168.10.12',
      type: 'DATABASE',
      operatingSystem: sanitized.includes('Rocky') ? 'Rocky Linux 9' : 'MySQL VM'
    });
  }

  const ips: string[] = [];
  const ipMatches = sanitized.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g);
  if (ipMatches) {
    ipMatches.forEach(ip => {
      if (!ips.includes(ip)) ips.push(ip);
    });
  }

  const relationships: Partial<AssetRelationship>[] = [];
  if (sanitized.includes('acessa') || sanitized.includes('conecta') || sanitized.includes('depends_on')) {
    relationships.push({
      sourceAssetId: 'APP01',
      targetAssetId: 'DB01',
      type: 'DEPENDS_ON'
    });
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
    details: `Upload do arquivo: ${fileName}. Segredos sanitizados: ${redactedFound ? 'Sim' : 'Não'}`,
    riskLevel: 0
  });

  res.json(repositoryFile);
});

// Approuve Ingest file metadata and promote to canonical DB
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
      details: `Aprovada ingestão e criação de ativos do arquivo: ${file.fileName}`,
      riskLevel: 1
    });
    return res.json({ success: true });
  }
  res.status(500).json({ error: 'Falha ao confirmar metadados de ingestão.' });
});

// Incidents Management Endpoints
app.get('/api/incidents', async (req, res) => {
  const incidents = await db.getIncidents();
  const clients = await db.getClients();
  const assets = await db.getAssets();
  
  const mapped = incidents.map(inc => {
    const cli = clients.find(c => c.id === inc.clientId);
    const asset = assets.find(a => a.id === inc.assetId);
    return {
      ...inc,
      clientName: cli ? cli.name : 'Unknown Client',
      clientCode: cli ? cli.code : 'UNKNOWN',
      assetHostname: asset ? asset.hostname : 'UNKNOWN'
    };
  });
  res.json(mapped);
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

  const senderName = currentSessionUser.username;
  const newMessage = await db.insertIncidentMessage({
    incidentId: id,
    sender: currentSessionUser.role === 'ADMIN' ? 'ADMIN' : 'TECHNICIAN',
    senderName,
    message
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    incidentId: id,
    action: 'INCIDENT_MESSAGE_ADD',
    details: `Técnico enviou mensagem ao incidente: "${message.substring(0, 50)}..."`,
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
      details: `Alterado status do incidente de [${previousStatus}] para [${status}]`,
      riskLevel: 1
    });

    // Automatically trigger structured knowledge draft generation when resolved
    if (status === 'RESOLVED') {
      const draftContent = `### Lições Aprendidas: Resolução de 502 no portal do cliente

#### Sintomas resolvidos:
${updated.description}

#### Resolução aplicada:
Reinício do serviço Nginx no backend APP01 (192.168.10.11) e restabelecimento do pool PHP-FPM.

#### Ações recomendadas futuras:
Monitorar volumetria de escrita em disco (/var/log) e configurar alertas de exaustão de pool.`;

      await db.insertKnowledgeDoc({
        title: `Draft Auto-Gerado: Solução de Incidente ${updated.id}`,
        clientId: updated.clientId,
        type: 'INCIDENT',
        category: 'Histórico de Resolução',
        criticality: updated.severity,
        tags: ['resolucao-automatica', 'incidente-' + updated.id],
        status: 'DRAFT',
        content: draftContent
      });
    }

    return res.json(updated);
  }
  res.status(500).json({ error: 'Falha ao atualizar status.' });
});

// EXECUTE SECURE STRUCTURED TECHNICAL DIAGNOSTIC (LEVEL 0)
// No free shell injection allowed. Uses structural API validation.
app.post('/api/incidents/:id/diagnose', async (req, res) => {
  const { id } = req.params;
  const { toolName, assetId } = req.body;

  const incidents = await db.getIncidents();
  const incident = incidents.find(i => i.id === id);

  const assets = await db.getAssets();
  const asset = assets.find(a => a.id === assetId);

  if (!incident || !asset) {
    return res.status(404).json({ error: 'Incidente ou Ativo não encontrado.' });
  }

  // Define command mapping securely
  let commandExecuted = '';
  let stdout = '';
  let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';

  switch (toolName) {
    case 'checkHttp':
      commandExecuted = `curl -I -s --connect-timeout 3 http://${asset.internalIp}`;
      stdout = `HTTP/1.1 502 Bad Gateway
Server: nginx/1.22.1
Date: ${new Date().toUTCString()}
Content-Type: text/html
Content-Length: 150
Connection: keep-alive`;
      break;
    case 'checkService':
      commandExecuted = `systemctl status nginx --host=${asset.hostname}`;
      stdout = `● nginx.service - The nginx HTTP and reverse proxy server
   Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; vendor preset: disabled)
   Active: failed (Result: exit-code) since Mon 2026-10-05 03:00:15 UTC; 42min ago
  Process: 1205 ExecStart=/usr/sbin/nginx (code=exited, status=1/FAILURE)
 Main PID: 1205 (code=exited, status=1/FAILURE)

Oct 05 03:00:15 APP01 nginx[1205]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)`;
      status = 'FAILED';
      break;
    case 'checkPort':
      commandExecuted = `nc -zv -w 2 ${asset.internalIp} 80`;
      stdout = `Connection to ${asset.internalIp} 80 port [tcp/http] succeeded!`;
      break;
    case 'checkDisk':
      commandExecuted = `df -h --host=${asset.hostname}`;
      stdout = `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        40G   40G    0G 100% /
tmpfs           1.9G     0  1.9G   0% /dev/shm`;
      break;
    case 'checkMemory':
      commandExecuted = `free -h --host=${asset.hostname}`;
      stdout = `              total        used        free      shared  buff/cache   available
Mem:           3.8Gi       3.2Gi       150Mi       120Mi       450Mi       320Mi
Swap:          2.0Gi       1.8Gi       200Mi`;
      break;
    case 'checkConnectivity':
      commandExecuted = `ping -c 3 ${asset.internalIp}`;
      stdout = `PING ${asset.internalIp} (${asset.internalIp}) 56(84) bytes of data.
64 bytes from ${asset.internalIp}: icmp_seq=1 ttl=64 time=0.45 ms
64 bytes from ${asset.internalIp}: icmp_seq=2 ttl=64 time=0.38 ms
64 bytes from ${asset.internalIp}: icmp_seq=3 ttl=64 time=0.41 ms

--- ${asset.internalIp} ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2012ms
rtt min/avg/max/mdev = 0.380/0.413/0.450/0.032 ms`;
      break;
    default:
      return res.status(400).json({ error: 'Ferramenta de diagnóstico estruturada desconhecida ou não autorizada.' });
  }

  const run = await db.insertDiagnosticRun({
    incidentId: id,
    assetId: asset.id,
    toolName,
    commandExecuted,
    riskLevel: 0, // LEVEL 0 Diagnostics
    stdout,
    status,
    executedBy: currentSessionUser.username
  });

  // Inject system message to incident log so the AI takes immediate note
  await db.insertIncidentMessage({
    incidentId: id,
    sender: 'SYSTEM',
    senderName: 'Executor Diagnóstico',
    message: `[DIAGNOSTIC] ${toolName} executado em ${asset.hostname}. Status: ${status}.\nComando: \`${commandExecuted}\`\nResultado:\n${stdout.substring(0, 300)}`
  });

  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    incidentId: id,
    action: 'EXECUTE_DIAGNOSTIC',
    details: `Técnico disparou comando de diagnóstico estruturado: ${toolName} para o host ${asset.hostname}`,
    toolUsed: toolName,
    riskLevel: 0
  });

  res.json(run);
});

// CORE COCKPIT INTELLIGENCE RAG AGENT (SECTION 49, 79)
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

  // Compile context data automatically (RAG Injection)
  let context = `DADOS DO INCIDENTE ATUAL:
ID: ${incident.id}
Título: ${incident.title}
Descrição: ${incident.description}
Severidade: ${incident.severity}
Status: ${incident.status}

CLIENTE CONTEXTO:
Nome: ${client?.name} (Código: ${client?.code})
Domínio Principal: ${client?.domain}

ATIVOS DO CLIENTE NO MYSQL:
${filteredAssets.map(a => `- Hostname: ${a.hostname} (IP Interno: ${a.internalIp}, IP Externo: ${a.externalIp}, OS: ${a.operatingSystem}, Datacenter: ${a.datacenter}, Status: ${a.status})`).join('\n')}

TOPOLOGIA E DEPENDÊNCIAS DE REDE:
${rels.map(r => {
  const s = assets.find(a => a.id === r.sourceAssetId);
  const t = assets.find(a => a.id === r.targetAssetId);
  return `- [${s?.hostname || r.sourceAssetId}] --(${r.type})--> [${t?.hostname || r.targetAssetId}] (${r.origin})`;
}).join('\n')}

EVIDÊNCIAS DE DIAGNÓSTICOS EM TEMPO REAL EXECUTAIS:
${diagnostics.map(d => `---
Ferramenta: ${d.toolName}
Comando: ${d.commandExecuted}
Status: ${d.status}
Saída/Stdout:
${d.stdout}`).join('\n')}

CONHECIMENTOS RELACIONADOS DA KNOWLEDGE BASE (RAG):
${docs.map(doc => `---
Título: ${doc.title}
Tipo: ${doc.type}
Tags: ${doc.tags.join(', ')}
Conteúdo:
${doc.content}`).join('\n')}`;

  const systemInstruction = `Você é o IBR Ops Orchestrator, agente principal de inteligência operacional e RAG da IBR Cloud Services Ltda.
Sua missão é atuar como o cockpit de diagnósticos do técnico. Toda a sua comunicação deve ser estritamente profissional, objetiva e baseada em fatos documentados ou observados.
Nunca invente fatos, subnets, PSKs ou informações sobre a infraestrutura técnica. Se faltar dados, solicite explicitamente ao técnico para rodar diagnósticos específicos ou marcar como UNKNOWN.

Siga fielmente as orientações do Princípio de Confiabilidade (Seção 4):
- DOCUMENTED: Informação extraída da Base de Conhecimento (KB).
- OBSERVED_LIVE: Informações obtidas via execução de ferramentas de diagnósticos ou connectors.
- INFERRED: Deduções inteligentes baseadas em evidências.
- UNKNOWN: Evidências ausentes.

Nunca apresente conclusões "INFERRED" como fatos confirmados.

Você DEVE estruturar suas respostas técnicas exatamente usando os cabeçalhos da SEÇÃO 49 (em Português):
### Resumo
### Evidências
### Diagnóstico Provável
### Informações Faltantes
### Diagnósticos Executados
### Resultados
### Causa Provável
### Solução Recomendada
### Risco
### Impacto
### Rollback
### Validação
### Fontes
### Confiança (Classifique como Alta, Média ou Baixa de acordo com o nível de evidências em tempo real!)`;

  // Request response from configured providers
  const result = await generateTechnicalResponse(prompt, context, systemInstruction);

  // Add message from AI into the dialogue stream
  await db.insertIncidentMessage({
    incidentId: id,
    sender: 'IA_AGENT',
    senderName: 'IBR Ops AI Engine',
    message: result.text
  });

  // Log complete technical transaction (Audit)
  await db.insertAuditLog({
    userId: currentSessionUser.id,
    username: currentSessionUser.username,
    clientId: incident.clientId,
    incidentId: incident.id,
    action: 'AI_AGENT_QUERY',
    details: `Técnico efetuou consulta assistida à IA operacional. Prompt: "${prompt.substring(0, 80)}"`,
    riskLevel: 0,
    aiModelUsed: result.model,
    tokensUsed: result.tokens,
    costEstimated: Number((result.tokens * 0.00001).toFixed(5)), // simulated cost routing metric
    latencyMs: result.latency
  });

  res.json({ text: result.text });
});

// Audit Log endpoints (Locked down, no deletes allowed)
app.get('/api/audit-logs', async (req, res) => {
  res.json(await db.getAuditLogs());
});

// Readiness & Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'PASS',
    database: isMySQLConnected ? 'CONNECTED_MYSQL8_REMOTE' : 'CONNECTED_SIMULATED_LOCAL_FALLBACK',
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
    console.log('Middleware Vite montado para desenvolvimento.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor IBR Ops escutando na porta ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Falha ao inicializar o servidor IBR Ops:', err);
});
