import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

let pool: mysql.Pool | null = null;
export let isMySQLConnected = false;
export let mysqlConnectionError: string | null = null;

export async function initMySQL() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASS;
  const database = process.env.DB_NAME;

  if (!host || !user || !password || !database) {
    mysqlConnectionError = 'Variáveis de ambiente do banco MySQL (DB_HOST, DB_USER, DB_PASS, DB_NAME) incompletas.';
    console.warn('AVISO:', mysqlConnectionError, 'Rodando no modo persistência local (fallback).');
    return null;
  }

  try {
    pool = mysql.createPool({
      host,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000 // 5 seconds timeout to prevent long hangs on firewall blocks
    });

    // Test connection
    const connection = await pool.getConnection();
    console.log('Sucesso: Conectado ao banco MySQL canônico em:', host);
    connection.release();
    isMySQLConnected = true;
    mysqlConnectionError = null;

    // Bootstrap structure if it does not exist
    await bootstrapMySQLTables();

    return pool;
  } catch (err: any) {
    isMySQLConnected = false;
    mysqlConnectionError = err.message || String(err);
    console.warn('AVISO: Falha ao conectar ao servidor MySQL canônico remoto:', mysqlConnectionError);
    console.warn('O sistema utilizará automaticamente a base de persistência local simulada.');
    return null;
  }
}

export async function query(sql: string, params: any[] = []): Promise<any> {
  if (!pool || !isMySQLConnected) {
    throw new Error('Instância do MySQL não conectada.');
  }
  const [results] = await pool.execute(sql, params);
  return results;
}

// Automatically bootstrap tables to match specs in MySQL 8 if connected
async function bootstrapMySQLTables() {
  try {
    console.log('Executando migrações estruturais e verificação de tabelas no MySQL...');

    // 1. Users Table
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(50) PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        email VARCHAR(150) NOT NULL,
        role VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 2. Clients Table
    await query(`
      CREATE TABLE IF NOT EXISTS clients (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(100) NOT NULL UNIQUE,
        domain VARCHAR(255) NOT NULL,
        criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        sla_hours INT NOT NULL DEFAULT 4,
        createdAt VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 3. Client Contacts
    await query(`
      CREATE TABLE IF NOT EXISTS client_contacts (
        id VARCHAR(50) PRIMARY KEY,
        clientId VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(150) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        role VARCHAR(100) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 4. Assets Table
    await query(`
      CREATE TABLE IF NOT EXISTS assets (
        id VARCHAR(50) PRIMARY KEY,
        clientId VARCHAR(50) NOT NULL,
        datacenter VARCHAR(255) NOT NULL,
        environment VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        hostname VARCHAR(100) NOT NULL,
        displayName VARCHAR(255) NOT NULL,
        internalIp VARCHAR(50) NOT NULL,
        externalIp VARCHAR(50) NOT NULL,
        operatingSystem VARCHAR(100) NOT NULL,
        version VARCHAR(50) NOT NULL,
        criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        lastDiscovery VARCHAR(50) NOT NULL,
        lastValidation VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 5. Asset Relationships
    await query(`
      CREATE TABLE IF NOT EXISTS asset_relationships (
        id VARCHAR(50) PRIMARY KEY,
        sourceAssetId VARCHAR(50) NOT NULL,
        targetAssetId VARCHAR(50) NOT NULL,
        type VARCHAR(50) NOT NULL,
        origin VARCHAR(50) NOT NULL DEFAULT 'DISCOVERY',
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 6. Incidents Table
    await query(`
      CREATE TABLE IF NOT EXISTS incidents (
        id VARCHAR(50) PRIMARY KEY,
        clientId VARCHAR(50) NOT NULL,
        assetId VARCHAR(50) NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'NEW',
        severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        createdAt VARCHAR(50) NOT NULL,
        updatedAt VARCHAR(50) NOT NULL,
        resolvedAt VARCHAR(50) NULL,
        escalatedAt VARCHAR(50) NULL,
        escalationReason TEXT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 7. Incident Messages
    await query(`
      CREATE TABLE IF NOT EXISTS incident_messages (
        id VARCHAR(50) PRIMARY KEY,
        incidentId VARCHAR(50) NOT NULL,
        sender VARCHAR(50) NOT NULL,
        senderName VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        createdAt VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 8. Audit Logs
    await query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(50) PRIMARY KEY,
        userId VARCHAR(50) NOT NULL,
        username VARCHAR(100) NOT NULL,
        clientId VARCHAR(50) NULL,
        incidentId VARCHAR(50) NULL,
        action VARCHAR(100) NOT NULL,
        details TEXT NOT NULL,
        toolUsed VARCHAR(100) NULL,
        riskLevel INT NOT NULL DEFAULT 0,
        aiModelUsed VARCHAR(100) NULL,
        tokensUsed INT NULL,
        costEstimated DOUBLE NULL,
        latencyMs INT NULL,
        timestamp VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 9. Diagnostic Runs
    await query(`
      CREATE TABLE IF NOT EXISTS diagnostic_runs (
        id VARCHAR(50) PRIMARY KEY,
        incidentId VARCHAR(50) NOT NULL,
        assetId VARCHAR(50) NOT NULL,
        toolName VARCHAR(100) NOT NULL,
        commandExecuted VARCHAR(255) NOT NULL,
        riskLevel INT NOT NULL DEFAULT 0,
        stdout TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
        executedBy VARCHAR(100) NOT NULL,
        timestamp VARCHAR(50) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 10. Knowledge Documents
    await query(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        clientId VARCHAR(50) NULL,
        environment VARCHAR(50) NULL,
        type VARCHAR(50) NOT NULL,
        category VARCHAR(100) NOT NULL,
        criticality VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        tags TEXT NOT NULL,
        status VARCHAR(55) NOT NULL DEFAULT 'DRAFT',
        content TEXT NOT NULL,
        createdAt VARCHAR(50) NOT NULL,
        updatedAt VARCHAR(50) NOT NULL,
        verifiedAt VARCHAR(50) NULL,
        verifiedBy VARCHAR(100) NULL,
        version INT NOT NULL DEFAULT 1
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 11. Knowledge Conflicts
    await query(`
      CREATE TABLE IF NOT EXISTS knowledge_conflicts (
        id VARCHAR(50) PRIMARY KEY,
        documentId VARCHAR(50) NOT NULL,
        fieldName VARCHAR(100) NOT NULL,
        documentedValue VARCHAR(255) NOT NULL,
        documentedOrigin VARCHAR(255) NOT NULL,
        observedValue VARCHAR(255) NOT NULL,
        observedOrigin VARCHAR(255) NOT NULL,
        observedAt VARCHAR(50) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // 12. Repository Files
    await query(`
      CREATE TABLE IF NOT EXISTS repository_files (
        id VARCHAR(50) PRIMARY KEY,
        fileName VARCHAR(255) NOT NULL,
        fileSize INT NOT NULL,
        category VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        content TEXT NOT NULL,
        uploadedAt VARCHAR(50) NOT NULL,
        autoExtractedMetadata TEXT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Populate with defaults if tables are empty
    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    if (usersCount[0].count === 0) {
      console.log('Populando dados padrão no MySQL...');
      
      // Default users
      await query(`INSERT INTO users (id, username, email, role, status) VALUES 
        ('usr-1', 'bruno_admin', 'bruno.fantoni@inframail.com.br', 'ADMIN', 'ACTIVE'),
        ('usr-2', 'tech_diego', 'diego.tecnico@inframail.com.br', 'TECHNICIAN', 'ACTIVE'),
        ('usr-3', 'viewer_clara', 'clara.viewer@inframail.com.br', 'VIEWER', 'ACTIVE')`);

      // Default clients
      await query(`INSERT INTO clients (id, name, code, domain, criticality, status, sla_hours, createdAt) VALUES 
        ('cli-1', 'CRECI DF - Conselho Regional de Corretores de Imóveis', 'CRECI_DF', 'crecidf.org.br', 'HIGH', 'ACTIVE', 4, '2026-01-15T10:00:00Z'),
        ('cli-2', 'IBR Global Services', 'IBR_GLOBAL', 'ibrcloud.com.br', 'CRITICAL', 'ACTIVE', 2, '2026-01-01T08:00:00Z')`);

      // Contacts
      await query(`INSERT INTO client_contacts (id, clientId, name, email, phone, role) VALUES 
        ('cnt-1', 'cli-1', 'Dr. Geraldo Silva', 'geral@crecidf.org.br', '(61) 3328-1010', 'Diretor de TI'),
        ('cnt-2', 'cli-2', 'Bruno Fantoni', 'bruno.fantoni@inframail.com.br', '(11) 99999-8888', 'Diretor Operacional')`);

      // Assets
      await query(`INSERT INTO assets (id, clientId, datacenter, environment, type, hostname, displayName, internalIp, externalIp, operatingSystem, version, criticality, status, lastDiscovery, lastValidation) VALUES 
        ('ast-020', 'cli-2', 'Canadá (OVH)', 'PRODUCTION', 'PROXY', 'WEB020', 'WEB020 Proxy Central', '192.168.20.20', '198.50.120.20', 'AlmaLinux 9', '9.4', 'CRITICAL', 'ACTIVE', '2026-10-05T00:00:00Z', '2026-10-05T03:00:00Z'),
        ('ast-008', 'cli-2', 'Brasil (Equinix)', 'PRODUCTION', 'PROXY', 'WEB008', 'WEB008 Proxy Local', '192.168.8.8', '200.120.8.8', 'AlmaLinux 9', '9.4', 'CRITICAL', 'ACTIVE', '2026-10-05T01:00:00Z', '2026-10-05T03:00:00Z'),
        ('ast-101', 'cli-1', 'Canadá (OVH)', 'PRODUCTION', 'APPLICATION', 'APP01', 'CRECI APP01 Webserver', '192.168.10.11', '198.50.120.31', 'AlmaLinux 9', '9.4', 'HIGH', 'DEGRADED', '2026-10-05T01:15:00Z', '2026-10-05T03:15:00Z'),
        ('ast-102', 'cli-1', 'Canadá (OVH)', 'PRODUCTION', 'DATABASE', 'DB01', 'CRECI DB01 Database', '192.168.10.12', '198.50.120.32', 'Rocky Linux 9', '9.3', 'HIGH', 'ACTIVE', '2026-10-05T01:20:00Z', '2026-10-05T03:20:00Z')`);

      // Relationships
      await query(`INSERT INTO asset_relationships (id, sourceAssetId, targetAssetId, type, origin, status) VALUES 
        ('rel-1', 'ast-020', 'ast-008', 'VPN_CONNECTED_TO', 'DISCOVERY', 'ACTIVE'),
        ('rel-2', 'ast-101', 'ast-102', 'DEPENDS_ON', 'DOCUMENT', 'ACTIVE'),
        ('rel-3', 'ast-020', 'ast-101', 'PROXIES', 'DISCOVERY', 'ACTIVE')`);

      // Incident
      await query(`INSERT INTO incidents (id, clientId, assetId, title, description, status, severity, createdAt, updatedAt) VALUES 
        ('inc-1', 'cli-1', 'ast-101', 'Portal do CRECI DF retornando HTTP 502 Bad Gateway no Proxy Central', 'O portal institucional do CRECI DF está inacessível. O proxy central WEB020 exibe erro 502 Bad Gateway ao tentar encaminhar requisições para o servidor de aplicação APP01.', 'NEW', 'HIGH', '2026-10-05T03:00:00Z', '2026-10-05T03:00:00Z')`);

      // Message
      await query(`INSERT INTO incident_messages (id, incidentId, sender, senderName, message, createdAt) VALUES 
        ('msg-1', 'inc-1', 'SYSTEM', 'Monitoramento IBR', 'Alerta recebido do Proxy WEB020: Upstream APP01 (192.168.10.11) parou de responder na porta 80.', '2026-10-05T03:01:00Z')`);

      // Audit log
      await query(`INSERT INTO audit_logs (id, userId, username, action, details, riskLevel, timestamp) VALUES 
        ('aud-1', 'usr-1', 'bruno_admin', 'BOOTSTRAP', 'Inicialização canônica do sistema e preenchimento da carga inicial de clientes e ativos no MySQL remoto.', 0, '2026-10-05T03:42:00Z')`);

      // Knowledge Base
      await query(`INSERT INTO knowledge_documents (id, title, clientId, type, category, criticality, tags, status, content, createdAt, updatedAt, verifiedAt, verifiedBy) VALUES 
        ('doc-1', 'Runbook: Diagnóstico de Erro 502 Bad Gateway no Proxy WEB020', 'cli-2', 'RUNBOOK', 'Proxy Web', 'HIGH', 'nginx, 502, web020, backend-offline', 'CANONICAL', '### Procedimento de Diagnóstico Nginx 502 Bad Gateway\\n\\nEste documento orienta sobre a resolução de erros HTTP 502 emitidos pelo proxy WEB020 no Canadá quando direcionando tráfego aos servidores de clientes.\\n\\n#### 1. Sintomas Comuns\\n- O usuário acessa o site do cliente e recebe "502 Bad Gateway - Nginx".\\n- No log de erros do WEB020 (\\\\/var/log/nginx/error.log), aparecem mensagens como: connect() failed (111: Connection refused) while connecting to upstream.\\n\\n#### 2. Fluxo de Investigação (LEVEL 0)\\n1. **Verificar Conectividade de Porta:** Verifique se o proxy consegue atingir o IP do upstream correspondente na porta correta.\\n- *Comando:* ping -c 3 [IP_INTERNO]\\n2. **Verificar Status de Serviço no Backend:** Acesse o backend (ex: APP01) e cheque se o servidor web (Nginx, Apache, PM2) está ativo e escutando.\\n- *Comando:* systemctl status nginx\\n3. **Checar Uso de Disco:\\n- *Comando:* df -h\\n', '2026-02-10T14:00:00Z', '2026-02-10T14:00:00Z', '2026-02-11T10:00:00Z', 'bruno_admin'),
        ('doc-2', 'Topologia de Rede CRECI DF & Acesso VPN', 'cli-1', 'ARCHITECTURE', 'VPN & Redes', 'MEDIUM', 'creci, vpn, pfsense, subnets', 'CANONICAL', '### Configurações de Rede CRECI DF\\n\\nO ambiente de produção do CRECI DF está hospedado na sub-rede privada 192.168.10.0/24 interconectada ao proxy central WEB020 via túnel IPSec fechado no pfSense principal.\\n\\n#### IPs Reservados:\\n- **APP01 (Webserver principal):** 192.168.10.11\\n- **DB01 (MySQL Banco Canônico):** 192.168.10.12\\n', '2026-03-01T15:30:00Z', '2026-03-01T15:30:00Z', '2026-03-02T09:15:00Z', 'bruno_admin')`);
    }

    console.log('Tabelas MySQL validadas e populadas com sucesso.');
  } catch (err) {
    console.error('Falha crítica ao criar tabelas no MySQL canônico:', err);
  }
}
