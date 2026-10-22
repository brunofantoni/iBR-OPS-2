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

    // Ensure admin user exists if users table is empty
    const usersCount = await query('SELECT COUNT(*) as count FROM users');
    if (usersCount[0].count === 0) {
      console.log('Criando usuário administrador inicial no MySQL...');
      await query(`INSERT INTO users (id, username, email, role, status) VALUES 
        ('usr-admin', 'bruno_admin', 'bruno.fantoni@inframail.com.br', 'ADMIN', 'ACTIVE')`);
    }

    console.log('Tabelas MySQL verificadas e prontas para dados reais.');
  } catch (err) {
    console.error('Falha crítica ao verificar tabelas no MySQL canônico:', err);
  }
}
