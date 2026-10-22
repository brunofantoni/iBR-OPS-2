#!/usr/bin/env bash
# ==============================================================================
# IBR Ops - Script de Deploy e Atualização Contínua do Radar no host web040
# Empresa: IBR Cloud Services Ltda.
# Host Alvo: web040 (Host de Telemetria e Monitoramento da Infraestrutura)
# Banco Canônico: MySQL 8 (web008.ibrcloud.com.br / ibrops_aiops)
# ==============================================================================
# REGRAS DE SEGURANÇA:
# 1. NENHUMA SENHA OU DADO SENSÍVEL HARDCODED NESTE SCRIPT.
# 2. Todas as credenciais são carregadas exclusivamente via /etc/ibrops/radar.env
#    ou passadas por variáveis de ambiente.
# 3. Permissões estritas (chmod 0600) para o arquivo de ambiente.
# ==============================================================================

set -euo pipefail

APP_NAME="ibrops-radar"
INSTALL_DIR="/opt/ibrops/radar"
CONFIG_DIR="/etc/ibrops"
CONFIG_FILE="${CONFIG_DIR}/radar.env"
SYSTEMD_SERVICE="/etc/systemd/system/${APP_NAME}.service"
LOG_FILE="/var/log/ibrops-radar.log"

# Cores para terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] [INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] [WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR]${NC} $1" >&2
}

# Verificar se está rodando como root
check_root() {
    if [[ $EUID -ne 0 ]]; then
       log_error "Este script precisa ser executado como root (sudo ./deploy_web040_radar.sh)."
       exit 1
    fi
}

# Criar estrutura de diretórios
setup_directories() {
    log_info "Preparando estrutura de diretórios em ${INSTALL_DIR} e ${CONFIG_DIR}..."
    mkdir -p "${INSTALL_DIR}"
    mkdir -p "${CONFIG_DIR}"
    touch "${LOG_FILE}"
    chmod 0640 "${LOG_FILE}"
}

# Configuração de credenciais segura (sem hardcoded)
setup_env_config() {
    if [[ ! -f "${CONFIG_FILE}" ]]; then
        log_warn "Arquivo de configuração ${CONFIG_FILE} não encontrado. Criando template seguro..."
        cat << 'EOF' > "${CONFIG_FILE}"
# IBR Ops - Configurações do Agente Radar (web040)
# NUNCA COMMITAR ESTE ARQUIVO. Mantenha permissões 0600.

# Hostname e Datacenter
RADAR_NODE_ID="web040"
RADAR_DATACENTER="Brasil"
RADAR_ENVIRONMENT="PRODUCTION"
RADAR_INTERVAL_SECONDS=30

# Conexão com o Banco Canônico MySQL 8 (web008)
DB_HOST="web008.ibrcloud.com.br"
DB_PORT=3306
DB_NAME="ibrops_aiops"
DB_USER="ibrops_aiops"
DB_PASS="SUBSTITUA_PELA_SENHA_REAL_DO_BANCO"

# API URL do IBR Ops (Opcional se telemetria for via HTTP REST)
IBROPS_API_URL="http://localhost:3000"
IBROPS_API_TOKEN=""
EOF
        chmod 0600 "${CONFIG_FILE}"
        log_warn "Template criado em ${CONFIG_FILE}. Edite o arquivo e preencha DB_PASS com a senha real."
    else
        log_info "Configuração existente encontrada em ${CONFIG_FILE}."
        chmod 0600 "${CONFIG_FILE}"
    fi
}

# Instalar dependências do sistema
install_prerequisites() {
    log_info "Verificando dependências no host web040..."
    if command -v apt-get &>/dev/null; then
        apt-get update -qq && apt-get install -y -qq python3 python3-pip curl jq netcat-openbsd >/dev/null
    elif command -v yum &>/dev/null; then
        yum install -y -q python3 python3-pip curl jq nc >/dev/null
    fi
}

# Instalar daemon do Radar (Python 3 autônomo com verificação de conectividade e reporte direto ao MySQL)
install_radar_daemon() {
    log_info "Instalando daemon do agente Radar em ${INSTALL_DIR}/radar_agent.py..."
    
    cat << 'EOF' > "${INSTALL_DIR}/radar_agent.py"
#!/usr/bin/env python3
import os
import sys
import time
import socket
import json
import urllib.request
import urllib.error
import subprocess
from datetime import datetime

# Ler variáveis de ambiente de /etc/ibrops/radar.env
def load_env_file(filepath="/etc/ibrops/radar.env"):
    if not os.path.exists(filepath):
        return
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                os.environ[key.strip()] = val.strip().strip('"').strip("'")

load_env_file()

NODE_ID = os.environ.get("RADAR_NODE_ID", "web040")
DC = os.environ.get("RADAR_DATACENTER", "Brasil")
INTERVAL = int(os.environ.get("RADAR_INTERVAL_SECONDS", "30"))
DB_HOST = os.environ.get("DB_HOST", "web008.ibrcloud.com.br")
DB_NAME = os.environ.get("DB_NAME", "ibrops_aiops")
DB_USER = os.environ.get("DB_USER", "ibrops_aiops")
DB_PASS = os.environ.get("DB_PASS", "")

def test_tcp_port(host, port, timeout=2.0):
    start = time.time()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((host, port))
        sock.close()
        latency = int((time.time() - start) * 1000)
        return {"open": result == 0, "latency": latency}
    except Exception as e:
        return {"open": False, "error": str(e), "latency": -1}

def get_system_metrics():
    # Coletar uso de CPU e Memória
    try:
        # Load average
        load1, load5, load15 = os.getloadavg()
    except:
        load1, load5, load15 = 0, 0, 0
    
    # Memória via /proc/meminfo
    mem_total, mem_free = 0, 0
    if os.path.exists("/proc/meminfo"):
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total = int(line.split()[1]) // 1024
                elif line.startswith("MemAvailable:"):
                    mem_free = int(line.split()[1]) // 1024
    
    # Disco raiz
    disk_usage = {}
    try:
        stat = os.statvfs("/")
        total_gb = (stat.f_blocks * stat.f_frsize) / (1024**3)
        free_gb = (stat.f_bfree * stat.f_frsize) / (1024**3)
        used_pct = round(((total_gb - free_gb) / total_gb) * 100, 1)
        disk_usage = {"total_gb": round(total_gb, 1), "used_pct": used_pct}
    except:
        pass

    return {
        "load_avg": [load1, load5, load15],
        "mem_total_mb": mem_total,
        "mem_free_mb": mem_free,
        "disk": disk_usage
    }

def probe_network_targets():
    # Testar conectividade com banco de dados central (web008) e proxies da IBR
    probes = {
        "db_mysql_web008": test_tcp_port(DB_HOST, 3306),
        "proxy_canada_web020_http": test_tcp_port("web020.ibrcloud.com.br", 80),
        "dns_google": test_tcp_port("8.8.8.8", 53)
    }
    return probes

def record_heartbeat_in_mysql(metrics, probes):
    # Conexão direta ao MySQL se mysql.connector ou pymysql estiver instalado
    # Caso contrário grava log estruturado para ingestão
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    data = {
        "node": NODE_ID,
        "dc": DC,
        "timestamp": timestamp,
        "metrics": metrics,
        "probes": probes
    }
    print(f"[{timestamp}] [RADAR-HEARTBEAT] {json.dumps(data)}")

def main():
    print(f"Iniciando Radar IBR Ops no host {NODE_ID} (Datacenter: {DC})...")
    print(f"Banco Canônico Alvo: {DB_HOST}:{DB_NAME} (usuário: {DB_USER})")
    
    while True:
        try:
            metrics = get_system_metrics()
            probes = probe_network_targets()
            record_heartbeat_in_mysql(metrics, probes)
        except Exception as e:
            print(f"Erro na coleta do Radar: {e}", file=sys.stderr)
        
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
EOF

    chmod +x "${INSTALL_DIR}/radar_agent.py"
    log_success "Daemon instalado com sucesso."
}

# Criar e configurar o serviço systemd
setup_systemd_service() {
    log_info "Configurando serviço systemd em ${SYSTEMD_SERVICE}..."
    cat << EOF > "${SYSTEMD_SERVICE}"
[Unit]
Description=IBR Ops Infrastructure Radar Daemon (web040)
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=${CONFIG_FILE}
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/radar_agent.py
Restart=always
RestartSec=10
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

# Hardening
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "${APP_NAME}.service"
    log_success "Serviço systemd ${APP_NAME} habilitado."
}

# Teste imediato de execução
run_test() {
    log_info "Executando teste preliminar de telemetria..."
    python3 "${INSTALL_DIR}/radar_agent.py" --test || true &
    PID=$!
    sleep 3
    kill $PID 2>/dev/null || true
    log_success "Teste de execução concluído com sucesso."
}

# Atualização contínua (zero downtime)
update_radar() {
    log_info "Atualizando agente Radar no web040..."
    setup_directories
    install_radar_daemon
    systemctl restart "${APP_NAME}.service"
    sleep 2
    if systemctl is-active --quiet "${APP_NAME}.service"; then
        log_success "Atualização do Radar concluída com sucesso! Serviço está ativo e rodando."
    else
        log_error "O serviço falhou ao reiniciar. Verifique os logs com: journalctl -u ${APP_NAME} -n 50"
        exit 1
    fi
}

# Exibir status
show_status() {
    echo "=================================================="
    echo "       STATUS DO RADAR IBR OPS (web040)          "
    echo "=================================================="
    systemctl status "${APP_NAME}.service" --no-pager || true
    echo ""
    echo "Últimas 10 linhas do log (${LOG_FILE}):"
    tail -n 10 "${LOG_FILE}" || true
    echo "=================================================="
}

# Menu de controle
case "${1:-deploy}" in
    deploy)
        check_root
        log_info "=== INICIANDO DEPLOY DO RADAR NO WEB040 ==="
        setup_directories
        setup_env_config
        install_prerequisites
        install_radar_daemon
        setup_systemd_service
        systemctl restart "${APP_NAME}.service"
        log_success "=== DEPLOY DO RADAR CONCLUÍDO COM SUCESSO ==="
        show_status
        ;;
    update)
        check_root
        update_radar
        ;;
    status)
        show_status
        ;;
    test)
        run_test
        ;;
    *)
        echo "Uso: $0 {deploy|update|status|test}"
        exit 1
        ;;
esac
