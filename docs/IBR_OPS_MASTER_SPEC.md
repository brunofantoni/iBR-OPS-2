# IBR OPS
## MASTER SPECIFICATION V1

**Produto:** IBR Ops  
**Empresa:** IBR Cloud Services Ltda.  
**Tipo:** Plataforma interna de operações, conhecimento, infraestrutura e inteligência técnica  
**Banco canônico:** MySQL 8  
**IA principal:** OpenAI API  
**Idioma padrão:** Português do Brasil  
**Timezone padrão:** America/Sao_Paulo

---

# 1. REGRA PRINCIPAL DE DESENVOLVIMENTO

Este documento é a especificação canônica do projeto IBR Ops.
Leia integralmente esta especificação antes de implementar qualquer funcionalidade.
Não tome decisões arquiteturais que contradigam este documento.
Não substitua tecnologias definidas sem autorização.
Não invente informações de infraestrutura ausentes.
Quando uma informação não estiver disponível, marque explicitamente como UNKNOWN, UNVERIFIED ou PENDING_DISCOVERY.
Não tente implementar todo o roadmap simultaneamente.
O desenvolvimento deverá ocorrer por fases.
Antes de alterar arquitetura, banco, autenticação, segurança, Policy Engine, Executor, Connectors, Knowledge Base ou modelo de dados, consulte novamente esta especificação.

---

# 2. VISÃO DO PRODUTO

O IBR Ops será o cockpit operacional da IBR Cloud Services.
Seu objetivo é transformar conhecimento técnico atualmente distribuído entre pessoas, documentos, históricos, servidores, firewalls e sistemas em uma memória operacional institucional.
O IBR Ops NÃO será apenas um chatbot.
Ele será uma plataforma integrada para:
gestão de clientes
inventário de infraestrutura
Knowledge Base
RAG
IA operacional
incidentes
diagnóstico
discovery
topologia
VPN
acesso remoto
automação
auditoria
relatórios
aprendizado contínuo.

O objetivo central é transformar:
"Técnico pergunta ao Bruno"
em:
"Técnico consulta o IBR Ops."

O administrador deverá ser acionado principalmente quando houver:
risco elevado
decisão arquitetural
incerteza relevante
falta de autorização
alteração crítica
situação não documentada.

---

# 3. EXPERIÊNCIA PRINCIPAL

O técnico poderá escrever perguntas naturais como:
"Por que o site do cliente está fora?"
"APP01 está respondendo?"
"Qual VPN eu uso para acessar esse cliente?"
"Gere as instruções da VPN para Windows."
"Qual servidor hospeda este domínio?"
"WEB008 consegue acessar WEB020?"
"Por que este servidor não consegue acessar o banco?"
"Quais serviços dependem do WEB020?"
"Se eu reiniciar este host, quais clientes podem ser afetados?"
"Quais incidentes o CRECI DF teve este mês?"

O IBR Ops deverá utilizar simultaneamente, quando aplicável:
Knowledge Base
MySQL
topologia
histórico de incidentes
dados observados em tempo real
Connectors
diagnósticos
documentação.

---

# 4. PRINCÍPIO DE CONFIABILIDADE

Toda informação apresentada deverá ser classificada internamente como:
DOCUMENTED
OBSERVED_LIVE
INFERRED
UNKNOWN.

DOCUMENTED significa informação proveniente da Knowledge Base.
OBSERVED_LIVE significa informação obtida diretamente da infraestrutura.
INFERRED significa conclusão da IA baseada em evidências.
UNKNOWN significa que não existe evidência suficiente.

Nunca apresentar INFERRED como fato confirmado.
Quando DOCUMENTED e OBSERVED_LIVE divergirem, priorizar operacionalmente a observação atual, mas gerar KNOWLEDGE_CONFLICT.
Nunca sobrescrever silenciosamente informação conflitante.

---

# 5. ARQUITETURA GERAL

Arquitetura conceitual:
Frontend
→ Backend API
→ IBR Ops Orchestrator
→ AI Provider
→ Knowledge Retrieval
→ Topology Engine
→ Policy Engine
→ Connector Framework
→ Executor
→ Infraestrutura.

A IA nunca deverá possuir acesso irrestrito a shell, banco, firewall, API administrativa ou sistema externo.
Toda ação deverá passar pelo backend.

---

# 6. STACK

Utilizar preferencialmente:
Frontend:
React
TypeScript
interface responsiva
Backend:
Node.js
TypeScript
API modular.
Banco:
MySQL 8.
IA:
OpenAI API.
RAG:
OpenAI File Search inicialmente.
Fila:
implementar abstração para background jobs.
Tempo real:
WebSocket quando necessário.
Deploy:
compatível com Linux.
Não utilizar PostgreSQL.

---

# 7. MYSQL COMO FONTE CANÔNICA

MySQL 8 será a fonte canônica dos dados estruturados.
Todos os dados importantes deverão ser persistidos em MySQL.
Utilizar:
foreign keys
índices
transactions
migrations
timestamps
soft delete quando apropriado.
Arquivos Markdown NÃO substituem MySQL.
OpenAI File Search NÃO substitui MySQL.
Vector Store NÃO é banco canônico.

---

# 8. ENTIDADES PRINCIPAIS

Criar inicialmente:
users, roles, permissions, clients, client_contacts, contracts, slas, sites, datacenters, environments, assets, asset_interfaces, networks, subnets, routes, services, applications, domains, vpn_tunnels, asset_relationships, service_dependencies, connectors, connector_instances, connector_capabilities, incidents, incident_messages, incident_events, diagnostic_runs, tool_definitions, tool_executions, approvals, knowledge_documents, knowledge_versions, knowledge_conflicts, knowledge_sources, repositories, repository_files, ingestion_jobs, discovery_jobs, audit_logs, ai_usage, reports, secret_references.

Criar schema extensível.

---

# 9. USUÁRIOS E RBAC

Implementar:
ADMIN
TECHNICIAN
VIEWER.

ADMIN:
administração completa
aprovação de ações críticas
gestão de usuários
gestão de Connectors
gestão de KB
gestão de políticas
auditoria
custos.

TECHNICIAN:
opera incidentes
consulta KB
executa diagnósticos permitidos
executa ações autorizadas
gera conhecimento
utiliza terminal quando autorizado.

VIEWER:
consulta informações permitidas.

Não codificar nomes de pessoas nas regras.

---

# 10. OPENAI

Implementar abstração:
AIProvider.
Primeira implementação:
OpenAIProvider.
Configuração por ambiente:
AI_PROVIDER=openai
OPENAI_API_KEY
OPENAI_MODEL_ROUTER
OPENAI_MODEL_DEFAULT
OPENAI_MODEL_ADVANCED.

Não fixar modelos específicos no código.
Permitir alterar modelos sem alterar aplicação.

---

# 11. ROTEAMENTO DE IA

Utilizar modelo econômico para:
classificação
extração
resumos
roteamento
identificação de cliente
identificação de asset
classificação inicial de risco.

Utilizar modelo principal para:
RAG
diagnóstico
interpretação
runbooks
incidentes.

Utilizar modelo avançado somente quando necessário para:
problemas complexos
arquitetura
rede complexa
segurança
banco crítico
diagnóstico inconclusivo.

Registrar modelo utilizado, tokens, custo estimado e latência.

---

# 12. REPOSITÓRIOS

Criar módulo:
REPOSITÓRIOS.
Esta será a principal porta de entrada de conhecimento bruto.
Estrutura visual inicial:
Caixa de Entrada
IBR Global
Clientes
Infraestrutura
Runbooks
Incidentes Históricos
Descobertas
Arquivados.

---

# 13. UPLOAD SIMPLES

A experiência desejada é:
usuário arrasta arquivo
→ IBR Ops faz o restante.
Aceitar inicialmente:
MD
TXT
PDF
DOCX
XLSX
CSV
JSON
LOG.
Permitir múltiplos arquivos simultaneamente.

---

# 14. PIPELINE DE INGESTÃO

Ao receber arquivo:
UPLOAD
→ armazenar original
→ detectar formato
→ extrair conteúdo
→ procurar segredos
→ sanitizar conteúdo enviado à IA
→ classificar documento
→ identificar cliente
→ identificar ambiente
→ identificar datacenter
→ identificar assets
→ identificar IPs
→ identificar redes
→ identificar VPNs
→ identificar serviços
→ identificar aplicações
→ identificar tecnologias
→ identificar incidentes
→ identificar procedimentos
→ identificar relacionamentos
→ comparar com MySQL
→ comparar com KB
→ detectar duplicidades
→ detectar conflitos
→ sugerir alterações
→ apresentar revisão quando necessária
→ persistir dados aprovados
→ criar conhecimento
→ sincronizar File Search.

---

# 15. IMPORTAÇÃO AUTOMÁTICA

O usuário não deverá precisar preparar perfeitamente os documentos.
Exemplo:
um MD contendo:
CRECI DF
APP01
192.168.x.x
AlmaLinux
nginx
DB01
APP01 acessa DB01
deverá permitir à IA extrair:
cliente
assets
IPs
sistema operacional
serviços
relacionamento.

Apresentar ao usuário:
ativos encontrados
redes encontradas
serviços encontrados
relacionamentos encontrados
conflitos
segredos detectados.

Permitir:
APROVAR TUDO SEM CONFLITO
REVISAR
REJEITAR.

---

# 16. SEGREDOS DURANTE INGESTÃO

Detectar padrões como:
password
passwd
secret
token
authorization
private key
API key
connection string
PSK.
Nunca enviar segredo bruto ao LLM.
Substituir por marcadores quando necessário.
Exemplo:
[REDACTED_SECRET].

---

# 17. KNOWLEDGE BASE

Criar Knowledge Base estruturada.
Tipos:
GLOBAL
CLIENT
TECHNOLOGY
RUNBOOK
INCIDENT
POLICY
ARCHITECTURE
HISTORICAL.

Status:
DRAFT
VERIFIED
CANONICAL
SUPERSEDED
ARCHIVED.

Metadados:
id, title, client, environment, type, category, criticality, tags, status, createdAt, updatedAt, verifiedAt, verifiedBy, version.

---

# 18. FILE SEARCH

Integrar documentos apropriados ao OpenAI File Search.
Quando documento CANONICAL for criado ou atualizado:
gerar representação adequada
sincronizar File Search
registrar identificador externo
registrar versão.
File Search será camada de recuperação semântica.
Não será fonte canônica.

---

# 19. REALIMENTAÇÃO DA KB

Cada incidente resolvido deverá potencialmente produzir conhecimento.
Fluxo:
incidente
→ diagnóstico
→ solução
→ validação
→ RESOLVED
→ geração automática de conhecimento
→ DRAFT
→ revisão
→ VERIFIED ou CANONICAL
→ sincronização.
Gerar dois tipos quando aplicável:
conhecimento específico do cliente
runbook reutilizável.

---

# 20. CONFLITOS

Quando informação nova contradizer informação existente:
não sobrescrever.
Criar KNOWLEDGE_CONFLICT.
Mostrar:
valor documentado, origem, data, valor observado, origem, data.
Permitir:
manter, atualizar, mesclar, supersede, rejeitar.

---

# 21. CLIENTES

Cada cliente deverá possuir página própria.
Mostrar:
dados cadastrais, contatos, contratos, SLA, ambientes, sites, datacenters, redes, VPNs, assets, serviços, aplicações, domínios, incidentes, documentos, relatórios, topologia.

---

# 22. ASSETS

Tipos iniciais:
PHYSICAL_SERVER, VM, CONTAINER, FIREWALL, ROUTER, SWITCH, PROXY, DATABASE, APPLICATION, STORAGE, BACKUP_SERVER, CLOUD_SERVICE, OTHER.
Campos:
hostname, displayName, client, site, datacenter, environment, internalIp, externalIp, operatingSystem, version, criticality, status, lastDiscovery, lastValidation.

---

# 23. DATACENTERS INICIAIS

Preparar suporte a múltiplos datacenters.
Existem inicialmente pelo menos dois ambientes relevantes de proxy da IBR:
WEB020 (Canadá) - proxy web.
WEB008 (Brasil) - proxy web.
Existem túneis entre datacenters.
Não inventar dados de infraestrutura.

---

# 24. TOPOLOGIA

Criar módulo: TOPOLOGIA.
Representar graficamente assets, redes, VPNs, proxies, aplicações, etc.

---

# 25. RELACIONAMENTOS

Criar asset_relationships.
Tipos:
CONNECTED_TO, VPN_CONNECTED_TO, ROUTES_TO, PROXIES, LOAD_BALANCES, HOSTS, DEPENDS_ON, BACKS_UP, REPLICATES_TO, MONITORS, SERVES, PROTECTED_BY, RESOLVES_TO.

---

# 26. INTERFACE DA TOPOLOGIA

Permitir zoom, pan, fullscreen, filtros. Usar ícones, labels e indicadores.

---

# 27. PAINEL DO HOST

Ao clicar em asset, abrir painel lateral contendo dados, conectividade, VPNs, incidentes, etc.

---

# 28. DUPLO CLIQUE

Configurável para abrir SSH Terminal ou Remote Desktop.

---

# 29. CONNECTOR FRAMEWORK

Estruturado com Policy Engine para ações externas.

---

# 30. CONNECTORS PREVISTOS

Suporte futuro para pfSense, Proxmox, PBS, SSH, Zabbix, Wazuh, Cloudflare, etc.

---

# 31. PFSENSE CONNECTOR

Somente READ ONLY. Nunca retornar segredos.

---

# 32. VPN ASSISTANT

Ajudar a encontrar VPNs e gerar instruções para clientes e internos.

---

# 33. INSTRUÇÕES DE VPN

Gerar instruções CUSTOMER vs INTERNAL.

---

# 34. RISCO VPN

Níveis de riscos estruturados por ações.

---

# 35. PROXMOX CONNECTOR

Consultar nós, VMs, containers, CPU, RAM, etc.

---

# 36. PBS CONNECTOR

Consultar backups, falhas, datastores.

---

# 37. SSH EXECUTOR

IA usa ferramentas estruturadas (checkDisk, checkMemory, etc.), nunca shell livre.

---

# 38. LEVEL 0

Ações READ ONLY permitidas de diagnóstico automático.

---

# 39 - 41. LEVELS 1, 2, 3

Níveis de autorizações e aprovações correspondentes.

---

# 42. POLICY ENGINE

Valida RBAC, asset, ambiente, incidentes, risco, aprovações, etc.

---

# 43. AÇÕES PROIBIDAS INICIALMENTE

Nenhuma alteração massiva ou destrutiva direta pela IA.

---

# 44 - 45. TERMINAL WEB & REMOTE DESKTOP

Integrações preparadas.

---

# 46. INCIDENTES

Estados: NEW, TRIAGE, COLLECTING_DIAGNOSTICS, DIAGNOSED, SOLUTION_PROPOSED, WAITING_APPROVAL, EXECUTING, VALIDATING, RESOLVED, ESCALATED, CLOSED.

---

# 47. SEVERIDADE

LOW, MEDIUM, HIGH, CRITICAL.

---

# 48. TELA OPERAÇÕES

Interface cockpit do técnico dividida em Lado Esquerdo (Contexto), Centro (Conversa/Diagnóstico/IA), Lado Direito (Metadados/Incidente/Ações).

---

# 49. RESPOSTA OPERACIONAL DA IA

Estrutura detalhada de respostas técnicas.

---

# 50. DIAGNÓSTICO AUTOMÁTICO

Execução automática de comandos controlados de diagnóstico.

---

# 51. ESCALAMENTO

Mecanismo para gerar pacote completo de escalamento técnico.

---

# 52 - 53. IMPACT ANALYSIS & IA E TOPOLOGIA

Análise de dependências e caminhos de rede.

---

# 54 - 55. DISCOVERY & ÁREA DESCOBERTAS

Descoberta automática e painel de revisões de novas descobertas.

---

# 56. AUDITORIA

Log de auditoria protegido para segurança contra exclusão de relatórios/comandos.

---

# 57 - 61. RELATÓRIOS, METRICAS & DASHBOARD

Métricas de SLA, MTTR, custos de IA, eficiência operacional e gráficos operacionais.

---

# 62 - 64. SEGURANÇA, PROMPT INJECTION & SECRET PROVIDER

Isolamento de credenciais e sanitização de dados confidenciais.

---

# 65 - 67. JOBS, HEALTH & OBSERVABILIDADE

Background jobs, endpoints de prontidão/saúde, e rastreabilidade por Correlation ID.

---

# 68. TESTES

Suporte a testes unitários e de integração.

---

# 69 - 70. SIMULATION MODE & FEATURE FLAGS

FeatureFlags para habilitar/desabilitar ações e Simulation Mode (EXECUTOR_MODE=simulation).

---

# 71. MENU PRINCIPAL

Estrutura de navegação completa.

---

# 72 - 77. ROADMAP DE FASES

- Fase 1: Estrutura, MySQL local, aut, RBAC, repositórios, ingestão de arquivo, KB, OpenAI RAG, incidentes, chat, Policy Engine básico, Audit, Simulation.
- Fases 2-6: Avanços futuros.

---

# 78 - 79. CRITÉRIO MVP & CENÁRIO DE TESTE

Fluxo de diagnóstico de HTTP 502 de ponta a ponta.

---

# 80 - 85. REGRAS DE QUALIDADE, DOCUMENTAÇÃO & DIRETRIZES

Processo de aprendizado contínuo, relatórios de Phase Gates e manutenção da memória operacional da IBR Cloud Services.
