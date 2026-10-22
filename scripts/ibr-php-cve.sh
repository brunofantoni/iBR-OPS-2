#!/usr/bin/env bash
# =============================================================================
#  ibr-php-cve.sh  v1.0.0
#  IBR Cloud Services | Resposta ao php2shell (CVE-2026-109618 / CVE-2026-109619)
#
#  Script unico. Roda de um bastion com chave SSH e conecta nos servidores do
#  inventario (porta e usuario por host). Nada e instalado nos servidores: o
#  payload remoto trafega por stdin (ssh ... bash -s) e nao deixa arquivo la,
#  exceto /var/lib/ibr-ops/php-cve (lista de drop-ins e pacotes pre-patch).
#
#  MODOS
#    discover    (padrao) SOMENTE LEITURA. Para cada host: binarios PHP, SAPI,
#                quem esta servindo de fato, status do CVE, ini efetivo,
#                containers com PHP e indicios de comprometimento (IOC).
#    mitigate    Mitigacao provisoria (session.upload_progress.enabled=0) via
#                drop-in de ini + reload. NAO corrige o CVE.        [--apply]
#    unmitigate  Remove o drop-in da mitigacao.                     [--apply]
#    enroll      Cadastra uma chave SSH DEDICADA (padrao ~/.ssh/ibr_ops_ed25519, criada
#                se nao existir) nos hosts que hoje recusam a sua chave, via ssh-copy-id
#                (pede a senha de cada host, uma vez). Depois, use --key com ela.   [--apply]
#    patch       Atualiza so os pacotes PHP (apt/dnf/yum), valida, reinicia o
#                que ficou stale, testa HTTP local e faz rollback se piorar.
#                                                                   [--apply]
#
#  OPCOES
#    --apply               autoriza escrita (obrigatorio em mitigate/unmitigate/patch)
#    --yes                 nao pede confirmacao interativa
#    --only a,b            so esses hosts (nome do inventario; sem diferenciar maiusc.)
#    --include-explicit    inclui hosts marcados 'explicit' (WEB008, HD1WEB2C-NEW, .73)
#    --include-skipped     inclui hosts marcados 'skip' (AD, VPN, HD-*, DESKTOP)
#    --canary              executa apenas no primeiro host selecionado
#    --user U[,U2]         usuarios SSH em ordem (padrao: infrabrasil,ibrcloud)
#    --key PATH            chave privada unica para todos (ou use ssh-agent)
#    --enroll-key PATH     (enroll) chave a cadastrar (padrao ~/.ssh/ibr_ops_ed25519)
#    --enroll-via PATH     (enroll) chave que JA entra no host, usada para instalar a nova;
#                          o --keymap tem prioridade por host. Sem nenhuma, o ssh-copy-id usa
#                          as chaves do agent e, so entao, pede a senha.
#                          (necessario onde a senha esta desligada: so chave publica)
#    --keymap FILE         chave por host: linhas NOME_OU_IP|/caminho/chave (prevalece sobre --key).
#                          Necessario porque o ssh_config casa por NOME digitado, nao por IP.
#    --trust-new-hostkeys  aceita host keys NOVAS (accept-new). Chave ALTERADA
#                          continua sendo recusada, sempre.
#    --since YYYY-MM-DD    corte para IOC (padrao 2026-10-17, 1o ataque conhecido)
#    --parallel N          hosts em paralelo no discover (padrao 6)
#    --pre-hook CMD        (patch) comando local executado antes de cada host com
#                          NOME e IP como argumentos (ex.: snapshot Proxmox).
#                          Se falhar, o host e pulado.
#    --no-snapshot         (patch) assume que voce aceita patch sem snapshot
#    --keep-going          (mutacao) nao para na primeira falha
#    --inventory FILE      inventario alternativo: NOME|IP|PORTA|FLAG|NOTA|ALIAS
#                          ALIAS (opcional) = nome DNS usado na conexao SSH, para casar com
#                          ~/.ssh/config e known_hosts, que sao por nome e nao por IP.
#    --out DIR             diretorio de saida
#    --list                lista o inventario e sai
#    -h, --help
#
#  EXEMPLOS
#    ./ibr-php-cve.sh --key ~/.ssh/ibr_ops_ed25519                    # descobre tudo
#    ./ibr-php-cve.sh mitigate --apply --only WEB020 --canary
#    ./ibr-php-cve.sh patch --apply --no-snapshot --only WEB020,GUIO001
#    ./ibr-php-cve.sh patch --apply --pre-hook ./snap.sh --only IBR-WEB008 --include-explicit
#
#  REQUISITOS
#    Bastion: bash 4+, ssh, awk, timeout. Servidores: sudo -n liberado para o
#    usuario SSH (sem sudo o discover roda degradado: nao enxerga /proc de
#    outros usuarios e nao ha mutacao). Autenticacao so por chave.
#
#  SAIDA (em --out):  summary.tsv  ioc.txt  raw/<host>.txt  run.log
#  Codigo de saida:   0 = nada pendente | 2 = vulneravel, EOL ou IOC encontrado
#                     | 3 = falha de execucao em modo de mutacao
# =============================================================================
set -o pipefail

VERSION="1.0.0"
MODE="discover"
APPLY=0; YES=0; ONLY=""; INC_EXPL=0; INC_SKIP=0; CANARY=0
USERS="${IBR_SSH_USERS:-infrabrasil,ibrcloud}"
KEY="${IBR_SSH_KEY:-}"
KEYMAP_FILE=""
ENROLL_KEY=""; ENROLL_VIA=""
SHK="yes"
SINCE="2026-10-17"
PAR=6
PRE_HOOK=""; NO_SNAP=0; KEEP_GOING=0
INV_FILE=""; OUT=""; LIST_ONLY=0
HOST_TIMEOUT=1500

usage() { sed -n '3,/^# =====/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------
# Inventario (origem: IBR_Inventario_IPs_Portas_SSH.md, ref. 22/10/2026)
# FLAG: run = padrao | explicit = so com --only/--include-explicit | skip = so com --include-skipped
# pfSense (192.99.229.5) fica de fora de proposito: SSH nao validado.
# ---------------------------------------------------------------------------
inventory_builtin() {
cat <<'IBR_INVENTORY'
# NOME|IP|PORTA|FLAG|NOTA|ALIAS
CREA-AM|177.234.159.43|6650|run|porta 6650 e host crea-am-1 confirmados pelo Bruno (inventario dizia 22)|crea-am-1.ibrcloud.com.br
IBR-WEB008|10.0.0.8|6650|explicit|hospeda o MySQL do IBR Ops (ibrops_aiops): patch por ultimo e com backup do banco|web008.ibrcloud.com.br
IBR-ELASTICSEARCH|10.0.0.10|6650|run|
IBR-GRAYLOG|10.0.0.20|6650|run|
IBR-MYSQL001|10.0.0.30|6650|run|
IBR-WEB015|10.0.0.2|6650|run|
IBR-MAUTIC01|10.0.0.40|6650|run|
IBR-DESKTOP|10.0.0.9|6650|skip|conexao recusada na V5.3
IBR-VPNSERVER|10.0.0.1|6650|skip|timeout na V5.3
HD-LATAM-VPN|177.234.159.46|6650|skip|timeout na V5.3
HD-GSO-LATAM|10.100.50.10|6650|skip|timeout na V5.3
HD-QUALYS-LATAM|10.100.50.20|6650|skip|timeout na V5.3
CRT-RJ-WEB-01|10.200.0.100|6650|run|
CRT-RJ-DB-01|10.200.0.101|6650|run|
CRT-RJ-AD-01|10.200.0.10|6650|skip|timeout na V5.3
CRT-RJ-AD-02|10.200.0.210|6650|skip|sem rota na V5.3
CRECI-DF-AD-01|192.168.210.10|6650|skip|timeout na V5.3
CRECI-DF-WEB-01|192.168.211.5|6650|run|
CRECI-DF-APP-01|192.168.211.6|6650|run|
CRECI-DF-DB-01|192.168.211.7|6650|run|
WWW17-MTA1|192.99.229.6|6650|run||www17.ibrcloud.com.br
WEB020|10.110.0.20|6650|run|
GUIO001|10.110.0.11|6650|run|
GUIO002|10.110.0.12|6650|run|
GUIO003|10.110.0.13|6650|run|
GUIO004|10.110.0.14|6650|run|
GUIO005|10.110.0.15|6650|run|
GUIO006|10.110.0.16|6650|run|
GUIO007|10.110.0.17|6650|run|
HD1WEB2C-NEW|192.99.229.4|6650|explicit|fingerprint SSH divergente: conferir por canal confiavel antes de qualquer coisa
WEB021-PREVMOC|192.99.229.7|6650|run|
IP-51-222-69-72|51.222.69.72|6650|run|
HD1WEB1|51.222.69.73|6650|explicit|= IP-51-222-69-73 do inventario; falha de autenticacao na V5.3
IP-51-222-69-74|51.222.69.74|6650|run|
IP-51-222-69-75|51.222.69.75|6650|run|so chave publica
IP-51-222-69-76|51.222.69.76|6650|run|so chave publica
IP-51-222-69-77|51.222.69.77|6650|run|so chave publica
IP-51-222-69-78|51.222.69.78|6650|run|so chave publica
IBR_INVENTORY
}

# ---------------------------------------------------------------------------
# Payload remoto. Enviado por stdin: ssh ... "sudo -n env ... bash -s"
# ---------------------------------------------------------------------------
remote_payload() {
cat <<'IBR_REMOTE_PAYLOAD'
IBR_MODE="${IBR_MODE:-discover}"
IBR_SINCE="${IBR_SINCE:-2026-10-17}"
export LC_ALL=C
export PATH="$PATH:/usr/sbin:/sbin:/usr/local/sbin:/usr/local/bin"
CVE1="CVE-2026-109618"; CVE2="CVE-2026-109619"
DROPIN="99-ibr-cve-2026-109619.ini"
STATE="/var/lib/ibr-ops/php-cve"
ROOT=no; [ "$(id -u)" = 0 ] && ROOT=yes
TS=$(date +%Y%m%d-%H%M%S)

emit() { local o="" a; for a in "$@"; do a=${a//|//}; a=${a//$'\n'/ }; a=${a//$'\r'/}; o="$o|$a"; done; printf '%s\n' "${o#|}"; }

if command -v dpkg-query >/dev/null 2>&1; then PM=apt
elif command -v rpm >/dev/null 2>&1; then PM=rpm
else PM=none; fi

# ---------- classificacao ----------
vge() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]; }

owner_pkg() {
  local p r=""
  p=$(readlink -f "$1" 2>/dev/null); [ -n "$p" ] || p="$1"
  case $PM in
    apt) r=$(dpkg-query -S "$p" 2>/dev/null | head -n1 | cut -d: -f1) ;;
    rpm) r=$(rpm -qf "$p" 2>/dev/null | head -n1); case "$r" in *"not owned"*) r="" ;; esac
         [ -n "$r" ] && r=$(rpm -q --qf '%{NAME}' "$r" 2>/dev/null) ;;
  esac
  echo "${r:-source}"
}

pkg_version() {
  local v=""
  case $PM in
    apt) v=$(dpkg-query -W -f='${Version}' "$1" 2>/dev/null) ;;
    rpm) v=$(rpm -q --qf '%{VERSION}' "$1" 2>/dev/null) ;;
  esac
  v=${v#*:}; v=${v%%[-+~]*}
  echo "$v"
}

changelog_fixed() {
  local pkg="$1" c f t
  case $PM in
    apt)
      for c in "$pkg" "$(echo "$pkg" | sed -E 's/^(php[0-9.]*)-.*/\1-common/')"; do
        for f in "/usr/share/doc/$c/changelog.Debian.gz" "/usr/share/doc/$c/changelog.gz"; do
          [ -r "$f" ] || continue
          t=$(zcat "$f" 2>/dev/null)
          if echo "$t" | grep -q "$CVE1" && echo "$t" | grep -q "$CVE2"; then return 0; fi
        done
      done ;;
    rpm)
      t=$(rpm -q --changelog "$pkg" 2>/dev/null)
      if echo "$t" | grep -q "$CVE1" && echo "$t" | grep -q "$CVE2"; then return 0; fi ;;
  esac
  return 1
}

classify() {  # versao pacote -> status
  local v="$1" pkg="$2" br fixed="" label=""
  if [ -z "$v" ] || [ "$v" = "?" ]; then echo UNKNOWN_VERSION; return; fi
  br=$(echo "$v" | cut -d. -f1,2)
  case "$br" in 8.2) fixed=8.2.35;; 8.3) fixed=8.3.36;; 8.4) fixed=8.4.27;; 8.5) fixed=8.5.12;; esac
  if [ -n "$fixed" ]; then
    if vge "$v" "$fixed"; then echo FIXED_VERSION; return; fi
    if [ "$pkg" != source ] && changelog_fixed "$pkg"; then echo FIXED_BACKPORT; return; fi
    echo VULNERABLE; return
  fi
  case "$v" in
    5.*|7.0.*|7.1.*|7.2.*|7.3.*) label=EOL_NO_FIX ;;
    7.4.*|8.0.*|8.1.*)           label=NEEDS_BACKPORT ;;
    *) echo UNKNOWN_BRANCH; return ;;
  esac
  if [ "$pkg" != source ] && changelog_fixed "$pkg"; then echo FIXED_BACKPORT; else echo "$label"; fi
}

# ---------- descoberta de binarios PHP ----------
scan_bins() {  # $1 = rotulo da fase
  local SERV STAL CAND d pid comm exe l lp del b base kind safe own perm ver pkg srv st info up ml sd
  emit PHASE "$1"
  SERV=$(mktemp); STAL=$(mktemp); CAND=$(mktemp)
  if [ "$ROOT" = yes ]; then
    for d in /proc/[0-9]*; do
      pid=${d#/proc/}
      comm=$(cat "$d/comm" 2>/dev/null) || continue
      case "$comm" in
        php-fpm*|php-cgi*|php|php[0-9]*|lsphp*|frankenphp) ;;
        apache2|httpd|httpd.worker|httpd.event|lshttpd|litespeed)
          while read -r l; do
            [ -n "$l" ] || continue
            lp=${l%% *}; echo "$lp" >> "$SERV"
            case "$l" in *"(deleted)") echo "$lp|$pid" >> "$STAL" ;; esac
          done < <(grep -E 'libphp[0-9.]*\.so' "$d/maps" 2>/dev/null | awk '{print $6" "$7}' | sort -u)
          continue ;;
        *) continue ;;
      esac
      exe=$(readlink "$d/exe" 2>/dev/null); [ -n "$exe" ] || continue
      case "$exe" in *" (deleted)") exe=${exe% (deleted)}; echo "$exe|$pid" >> "$STAL" ;; esac
      echo "$exe" >> "$SERV"
    done
  fi
  {
    find /usr/bin /usr/sbin /usr/local /opt /srv /home /var/www -maxdepth 8 -type f -perm -u+x \
      \( -name 'php' -o -name 'php[0-9]*' -o -name 'php-fpm*' -o -name 'php-cgi*' -o -name 'lsphp*' -o -name 'frankenphp' \) 2>/dev/null
    find /usr/lib /usr/lib64 /usr/libexec /opt -maxdepth 8 -type f -path '*/modules/*' -name 'libphp*.so' 2>/dev/null
    cat "$SERV"
  } | while IFS= read -r l; do
        [ -n "$l" ] || continue
        r=$(readlink -f "$l" 2>/dev/null); echo "${r:-$l}"
      done | sort -u > "$CAND"
  while IFS= read -r b; do
    [ -n "$b" ] || continue
    base=${b##*/}
    case "$base" in
      libphp*)      kind=mod_php ;;
      php-fpm*)     kind=fpm ;;
      php-cgi*)     kind=cgi ;;
      lsphp*)       kind=lsapi ;;
      frankenphp*)  kind=franken ;;
      httpd*|apache2*|lshttpd|litespeed) continue ;;
      *)            kind=cli ;;
    esac
    safe=no
    case "$b" in
      /usr/*|/opt/*)
        own=$(stat -c %u "$b" 2>/dev/null); perm=$(stat -c %A "$b" 2>/dev/null)
        if [ "$own" = 0 ]; then case "$perm" in ?????w*|????????w*) ;; *) safe=yes ;; esac; fi ;;
    esac
    if [ "$safe" = no ] && [ -e "$b" ]; then emit IOC_BINPATH "$b" "binario PHP em caminho gravavel/nao-root: NAO executado"; fi
    ver="?"; pkg=source
    if [ -e "$b" ]; then pkg=$(owner_pkg "$b"); fi
    if [ "$kind" != mod_php ] && [ "$safe" = yes ]; then
      ver=$(timeout 5 "$b" -n -v </dev/null 2>/dev/null | head -n1 | awk '{print $2}')
      case "$ver" in [0-9]*.[0-9]*) ;; *) ver="?" ;; esac
    fi
    if [ "$ver" = "?" ] && [ "$pkg" != source ]; then ver=$(pkg_version "$pkg"); fi
    ver=${ver%%[-+~]*}; [ -n "$ver" ] || ver="?"
    if [ "$safe" = no ]; then st=UNKNOWN_UNSAFE_PATH; else st=$(classify "$ver" "$pkg"); fi
    if [ "$kind" = cli ]; then srv=no
    elif [ "$ROOT" != yes ]; then srv="?"
    elif grep -qxF "$b" "$SERV"; then srv=yes
    else srv=no; fi
    emit BIN "$b" "$kind" "$ver" "$pkg" "$srv" "$st"
    if [ "$kind" = fpm ] && [ "$safe" = yes ]; then
      info=$(timeout 15 "$b" -i </dev/null 2>/dev/null)
      up=$(echo "$info" | awk -F' => ' '$1=="session.upload_progress.enabled"{print $2; exit}')
      ml=$(echo "$info" | awk -F' => ' '$1=="memory_limit"{print $2; exit}')
      sd=$(echo "$info" | awk -F' => ' '$1 ~ /^Scan this dir for additional .ini files/{print $2; exit}')
      emit INI "$b" "upload_progress=${up:-?}" "memory_limit=${ml:-?}" "scan_dir=${sd:-?}"
    fi
  done < "$CAND"
  while IFS='|' read -r exe pid; do [ -n "$exe" ] && emit STALE "$exe" "$pid"; done < <(sort -u "$STAL")
  rm -f "$SERV" "$STAL" "$CAND"
}

scan_containers() {
  local rt id img name v st
  for rt in docker podman; do
    command -v "$rt" >/dev/null 2>&1 || continue
    "$rt" ps --format '{{.ID}}|{{.Image}}|{{.Names}}' 2>/dev/null | while IFS='|' read -r id img name; do
      v=$(timeout 8 "$rt" exec "$id" php -n -v 2>/dev/null </dev/null | head -n1 | awk '{print $2}')
      [ -n "$v" ] || v=$(timeout 8 "$rt" exec "$id" php-fpm -n -v 2>/dev/null </dev/null | head -n1 | awk '{print $2}')
      case "$v" in [0-9]*.[0-9]*) ;; *) continue ;; esac
      v=${v%%[-+~]*}
      st=$(classify "$v" source)
      emit CONT "$id" "$img" "$name" "$v" "$st"
    done
  done
}

# ---------- IOC (heuristicas; nao sao prova) ----------
scan_ioc() {
  local roots r tmpf dt usr sz path tag nsus=0 nrec=0 total
  roots=$( {
      command -v nginx >/dev/null 2>&1 && nginx -T 2>/dev/null | awk '$1=="root"{gsub(/;/,"",$2); print $2}'
      grep -rhsE '^[[:space:]]*DocumentRoot' /etc/apache2 /etc/httpd 2>/dev/null | awk '{gsub(/"/,"",$2); print $2}'
      echo /var/www
    } | grep -E '^/' | grep -v '\$' | awk -F/ 'NF>=3' | sort -u | head -n 25 )
  tmpf=$(mktemp)
  for r in $roots; do
    [ -d "$r" ] || continue
    timeout 90 find "$r" -xdev -type f \( -name '*.php' -o -name '*.phtml' -o -name '*.phar' -o -name '*.inc' -o -name '.user.ini' \) \
      -newermt "$IBR_SINCE" -printf '%TY-%Tm-%Td %TH:%TM|%u|%s|%p\n' 2>/dev/null | head -n 400 > "$tmpf"
    total=$(wc -l < "$tmpf")
    emit IOC_ROOT "$r" "arquivos_php_alterados_desde_${IBR_SINCE}=$total"
    while IFS='|' read -r dt usr sz path; do
      case "$path" in
        */upload*/*|*/tmp/*|*/temp/*|*/files/*|*/images/*|*/img/*|*/media/*|*/sessions/*) tag=SUSPECT ;;
        *) tag=RECENT ;;
      esac
      if [ "$tag" = SUSPECT ]; then
        nsus=$((nsus+1)); [ "$nsus" -le 100 ] && emit IOC_FILE SUSPECT "$dt" "$usr" "$sz" "$path"
      else
        nrec=$((nrec+1)); [ "$nrec" -le 40 ] && emit IOC_FILE RECENT "$dt" "$usr" "$sz" "$path"
      fi
    done < "$tmpf"
  done
  rm -f "$tmpf"

  local lines n f
  lines=$( {
      command -v journalctl >/dev/null 2>&1 && timeout 60 journalctl --since "$IBR_SINCE" --no-pager -q 2>/dev/null \
        | grep -Ei 'php|apache|httpd|lsphp' | grep -Ei 'SIGSEGV|SIGABRT|SIGBUS|exited on signal (6|7|11)|exit signal (Segmentation|Aborted|Bus)|segfault'
      dmesg -T 2>/dev/null | grep -Ei 'segfault' | grep -Ei 'php|apache|httpd|lsphp'
      for f in /var/log/php*fpm*.log* /var/log/php-fpm/* /var/log/php/*.log* /var/log/apache2/error.log* /var/log/httpd/error_log* /opt/cpanel/ea-php*/root/usr/var/log/php-fpm/*; do
        [ -f "$f" ] && timeout 30 zgrep -hEi 'exited on signal (6|7|11)|exit signal (Segmentation|Aborted|Bus)|segfault' "$f" 2>/dev/null
      done
    } | tail -n 400 )
  n=$(printf '%s' "$lines" | grep -c .)
  emit IOC_CRASH "$n"
  printf '%s\n' "$lines" | grep . | tail -n 5 | cut -c1-220 | while IFS= read -r l; do emit IOC_CRASHLINE "$l"; done

  local PS
  PS=$(ps -eo pid=,ppid=,user=,comm=,args= 2>/dev/null)
  awk 'NR==FNR{c[$1]=$4; next}
       ($2 in c) && c[$2] ~ /^(php-fpm|php-cgi|apache2|httpd|lsphp|lshttpd|nginx|php[0-9.]*)/ &&
       $4 ~ /^(sh|bash|dash|zsh|nc|ncat|socat|curl|wget|python[0-9.]*|perl|ruby|busybox|telnet)$/ {print}' \
       <(echo "$PS") <(echo "$PS") | cut -c1-220 | head -n 20 | while IFS= read -r l; do emit IOC_PROC "$l"; done
}

# ---------- util de servico ----------
php_units() {
  systemctl list-units --type=service --state=active --no-legend --plain 2>/dev/null | awk '{print $1}' | grep -E 'php.*fpm'
}
apache_unit() {
  local u
  for u in apache2.service httpd.service; do systemctl is-active -q "$u" 2>/dev/null && { echo "$u"; return; }; done
}
test_configs() {  # $1 = saida de scan_bins; retorna !=0 se algum php-fpm -t falhar
  local b rc=0
  for b in $(echo "$1" | awk -F'|' '$1=="BIN" && $3=="fpm" && $7!="UNKNOWN_UNSAFE_PATH"{print $2}'); do
    timeout 20 "$b" -t >/dev/null 2>&1 </dev/null || { emit ERR "php-fpm -t falhou: $b"; rc=1; }
  done
  return $rc
}
restart_stale() {  # $1 = saida de scan_bins
  local stale u au
  stale=$(echo "$1" | awk -F'|' '$1=="STALE"{print $2}')
  [ -n "$stale" ] || return 0
  if echo "$stale" | grep -qE 'fpm|php'; then
    for u in $(php_units); do systemctl restart "$u" 2>/dev/null || emit ERR "falha ao reiniciar $u"; done
  fi
  if echo "$stale" | grep -q 'libphp'; then
    au=$(apache_unit); [ -n "$au" ] && { systemctl restart "$au" 2>/dev/null || emit ERR "falha ao reiniciar $au"; }
  fi
  return 0
}
probe_http() {
  command -v curl >/dev/null 2>&1 || { echo NOCURL; return; }
  local p s code res=""
  for p in $(ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -un | grep -E '^(80|443|8080|8443)$'); do
    case $p in 443|8443) s=https;; *) s=http;; esac
    code=$(curl -sk -o /dev/null -m 10 -w '%{http_code}' "$s://127.0.0.1:$p/" 2>/dev/null)
    res="$res $p=${code:-000}"
  done
  echo "${res# }"
}
probe_worse() {  # antes depois -> 0 se piorou
  local b="$1" a="$2" t p c bc worse=1
  for t in $a; do
    p=${t%%=*}; c=${t#*=}
    bc=$(echo "$b" | tr ' ' '\n' | awk -F= -v p="$p" '$1==p{print $2}')
    [ -n "$bc" ] || continue
    if [ "$bc" != 000 ] && [ "$bc" -lt 500 ] 2>/dev/null; then
      if [ "$c" = 000 ] || [ "$c" -ge 500 ] 2>/dev/null; then worse=0; fi
    fi
  done
  return $worse
}

# ---------- mitigacao ----------
dropin_dirs() {  # $1 = saida de scan_bins
  {
    echo "$1" | awk -F'|' '$1=="INI"{print $5}' | sed 's/^scan_dir=//' | grep -E '^/'
    ls -d /etc/php/*/fpm/conf.d /etc/php/*/apache2/conf.d /etc/php/*/cgi/conf.d /etc/php.d \
          /etc/opt/remi/php*/php.d /opt/remi/php*/root/etc/php.d /opt/cpanel/ea-php*/root/etc/php.d 2>/dev/null
  } | sort -u
}
do_mitigate() {
  local SC d f au
  [ "$ROOT" = yes ] || { emit MITIGATE FAILED "requer root (sudo -n)"; return 1; }
  mkdir -p "$STATE"
  SC=$(scan_bins before); echo "$SC"
  for d in $(dropin_dirs "$SC"); do
    [ -d "$d" ] || continue
    f="$d/$DROPIN"
    {
      echo "; ibr-ops: mitigacao PROVISORIA CVE-2026-109619 (php2shell) em $(date -Is). Remover apos o patch."
      echo "session.upload_progress.enabled = 0"
      case "$d" in */8.5/*|*php85*) echo "fatal_error_backtraces = 0" ;; esac
    } > "$f" && chmod 644 "$f" && echo "$f" >> "$STATE/dropins.list" && emit MITIGATE WROTE "$f"
  done
  if ! test_configs "$SC"; then
    for f in $(sort -u "$STATE/dropins.list" 2>/dev/null); do rm -f "$f"; done
    emit MITIGATE FAILED "php-fpm -t falhou; drop-ins removidos"; return 1
  fi
  for u in $(php_units); do systemctl reload "$u" 2>/dev/null || systemctl restart "$u" 2>/dev/null || emit ERR "falha ao recarregar $u"; done
  au=$(apache_unit)
  if [ -n "$au" ] && echo "$SC" | awk -F'|' '$1=="BIN" && $3=="mod_php" && $6=="yes"' | grep -q .; then
    (apachectl -t >/dev/null 2>&1 || apache2ctl -t >/dev/null 2>&1 || httpd -t >/dev/null 2>&1) \
      && { systemctl reload "$au" 2>/dev/null || systemctl restart "$au" 2>/dev/null; } || emit ERR "apache configtest falhou: nao recarregado"
  fi
  sleep 2
  SC=$(scan_bins after); echo "$SC"
  if [ ! -s "$STATE/dropins.list" ] || ! grep -q . "$STATE/dropins.list"; then
    emit MITIGATE NOOP "nenhum diretorio de ini do PHP web encontrado: nada aplicado (mod_php/cgi/LiteSpeed: configurar manualmente)"
  elif echo "$SC" | awk -F'|' '$1=="INI" && $3!="upload_progress=Off"' | grep -q .; then
    emit MITIGATE PARTIAL "algum php-fpm ainda com upload_progress ligado (pool override?)"
  else
    emit MITIGATE OK "upload_progress desligado nos php-fpm; mod_php/cgi: confirmar manualmente. Isto NAO corrige o CVE"
  fi
}
do_unmitigate() {
  local f au u
  [ "$ROOT" = yes ] || { emit MITIGATE FAILED "requer root (sudo -n)"; return 1; }
  for f in $(sort -u "$STATE/dropins.list" 2>/dev/null) $(ls /etc/php/*/*/conf.d/$DROPIN /etc/php.d/$DROPIN /etc/opt/remi/php*/php.d/$DROPIN /opt/cpanel/ea-php*/root/etc/php.d/$DROPIN 2>/dev/null); do
    [ -f "$f" ] && rm -f "$f" && emit MITIGATE REMOVED "$f"
  done
  : > "$STATE/dropins.list" 2>/dev/null
  for u in $(php_units); do systemctl reload "$u" 2>/dev/null || systemctl restart "$u" 2>/dev/null; done
  au=$(apache_unit); [ -n "$au" ] && systemctl reload "$au" 2>/dev/null
  emit MITIGATE OK "mitigacao removida"
}

# ---------- patch ----------
PHP_REGEX_APT='^(php[0-9.]*(-.*)?|libapache2-mod-php[0-9.]*|libphp[0-9.]*(-.*)?)$'
PHP_REGEX_RPM='^(php[0-9]*(-.*)?|.*-php(-.*)?|ea-php.*|alt-php.*)$'

do_patch() {
  local PRE POST pkgs held sim before_file units_before u rc=0 hb ha vuln_pk vuln_src still
  [ "$ROOT" = yes ] || { emit PATCH FAILED "requer root (sudo -n)"; return 1; }
  [ "$PM" != none ] || { emit PATCH FAILED "sem gerenciador de pacotes suportado (apt/rpm)"; return 1; }
  mkdir -p "$STATE"
  PRE=$(scan_bins before); echo "$PRE"
  vuln_pk=$(echo "$PRE" | awk -F'|' '$1=="BIN" && ($7=="VULNERABLE"||$7=="NEEDS_BACKPORT") && $5!="source"{print $5}' | sort -u)
  vuln_src=$(echo "$PRE" | awk -F'|' '$1=="BIN" && ($7=="VULNERABLE"||$7=="NEEDS_BACKPORT") && $5=="source"{print $2}' | sort -u)
  if [ -z "$vuln_pk" ]; then
    if [ -n "$vuln_src" ]; then emit PATCH MANUAL "PHP vulneravel fora de pacote (build manual): $(echo $vuln_src | tr '\n' ' ')"
    elif echo "$PRE" | awk -F'|' '$1=="BIN" && $7=="EOL_NO_FIX"' | grep -q .; then emit PATCH NOOP "EOL sem correcao: usar mitigate + isolamento + migracao"
    else emit PATCH NOOP "nada vulneravel por pacote"; fi
    return 0
  fi
  units_before=$(php_units; apache_unit)
  hb=$(probe_http)
  emit PATCH INFO "http_antes=$hb pacotes_vulneraveis=$(echo $vuln_pk | tr '\n' ' ')"
  before_file="$STATE/before-$TS.txt"
  case $PM in
    apt)
      pkgs=$(dpkg-query -W -f='${db:Status-Abbrev} ${Package}\n' 2>/dev/null | awk '$1=="ii"{print $2}' | grep -E "$PHP_REGEX_APT" | sort -u)
      held=$(apt-mark showhold 2>/dev/null | grep -E "$PHP_REGEX_APT")
      [ -z "$held" ] || { emit PATCH FAILED "pacotes PHP em hold: $(echo $held | tr '\n' ' ')"; return 1; }
      dpkg-query -W -f='${Package}=${Version}\n' $pkgs > "$before_file" 2>/dev/null
      apt-get update -qq >/dev/null 2>&1 || emit PATCH WARN "apt-get update retornou erro (repo indisponivel?)"
      sim=$(apt-get -s install --only-upgrade $pkgs 2>&1)
      if echo "$sim" | grep -q '^Remv '; then emit PATCH FAILED "a simulacao removeria pacotes: abortado"; return 1; fi
      if ! echo "$sim" | grep -q '^Inst '; then
        emit PATCH NOOP "repositorio sem versao nova (correcao ainda nao publicada?): aplicar mitigate"
        return 0
      fi
      DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y --only-upgrade \
        -o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef -o DPkg::Lock::Timeout=180 $pkgs >"$STATE/apt-$TS.log" 2>&1 || rc=1 ;;
    rpm)
      pkgs=$(rpm -qa --qf '%{NAME}\n' | grep -E "$PHP_REGEX_RPM" | sort -u)
      rpm -qa --qf '%{NAME}-%{VERSION}-%{RELEASE}\n' | grep -E "$(echo "$pkgs" | paste -sd'|' -)" > "$before_file" 2>/dev/null
      if command -v dnf >/dev/null 2>&1; then dnf -y upgrade --refresh $pkgs >"$STATE/pm-$TS.log" 2>&1 || rc=1
      else yum -y update $pkgs >"$STATE/pm-$TS.log" 2>&1 || rc=1; fi ;;
  esac
  if [ "$rc" -ne 0 ]; then emit PATCH FAILED "gerenciador de pacotes retornou erro (log em $STATE)"; patch_rollback; return 1; fi

  POST=$(scan_bins mid)
  restart_stale "$POST"
  sleep 3
  if ! test_configs "$POST"; then patch_rollback; return 1; fi
  for u in $units_before; do
    systemctl is-active -q "$u" 2>/dev/null || { emit PATCH FAILED "servico $u nao voltou ativo"; patch_rollback; return 1; }
  done
  ha=$(probe_http)
  if [ "$hb" != NOCURL ] && probe_worse "$hb" "$ha"; then
    emit PATCH FAILED "HTTP local piorou: antes=$hb depois=$ha"; patch_rollback; return 1
  fi
  POST=$(scan_bins after); echo "$POST"
  still=$(echo "$POST" | awk -F'|' '$1=="BIN" && ($7=="VULNERABLE"||$7=="NEEDS_BACKPORT"){print $2}' | sort -u)
  if echo "$POST" | grep -q '^STALE|'; then emit PATCH WARN "processo ainda rodando binario antigo (STALE): reiniciar servico"; fi
  if [ -n "$still" ]; then emit PATCH OK_STILL_VULNERABLE "versao instalada ainda sem correcao: $(echo $still | tr '\n' ' ')"
  else emit PATCH OK "http_antes=$hb http_depois=$ha"; fi
}
patch_rollback() {
  case $PM in
    apt) DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 apt-get install -y --allow-downgrades \
           -o Dpkg::Options::=--force-confold $(cat "$STATE/before-$TS.txt") >"$STATE/rollback-$TS.log" 2>&1 \
         && { restart_stale "$(scan_bins rb)"; emit PATCH ROLLED_BACK "pacotes voltaram a versao anterior"; } \
         || emit PATCH ROLLBACK_FAILED "downgrade falhou (versao antiga indisponivel no repo?): restaurar snapshot" ;;
    rpm) { dnf -y history undo last || yum -y history undo last; } >"$STATE/rollback-$TS.log" 2>&1 \
         && { restart_stale "$(scan_bins rb)"; emit PATCH ROLLED_BACK "transacao desfeita"; } \
         || emit PATCH ROLLBACK_FAILED "history undo falhou: restaurar snapshot" ;;
  esac
}

# ---------- main remoto ----------
emit HOST "$(hostname -f 2>/dev/null || hostname)" "$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")" "$PM" "$ROOT" \
  "$(ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -Ev '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)' | paste -sd, -)" \
  "$(ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -un | grep -E '^(80|443|8080|8443)$' | paste -sd, -)"
case "$IBR_MODE" in
  discover)   scan_bins before; scan_containers; scan_ioc ;;
  mitigate)   do_mitigate ;;
  unmitigate) do_unmitigate ;;
  patch)      do_patch ;;
  *)          emit ERR "modo desconhecido: $IBR_MODE" ;;
esac
emit DONE "$IBR_MODE"
IBR_REMOTE_PAYLOAD
}

# ---------------------------------------------------------------------------
# Bastion
# ---------------------------------------------------------------------------
die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }

[ $# -gt 0 ] && case "$1" in discover|mitigate|unmitigate|patch|enroll) MODE="$1"; shift ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --yes) YES=1 ;;
    --only) ONLY="$2"; shift ;;
    --include-explicit) INC_EXPL=1 ;;
    --include-skipped) INC_SKIP=1 ;;
    --canary) CANARY=1 ;;
    --user|--users) USERS="$2"; shift ;;
    --key) KEY="$2"; shift ;;
    --keymap) KEYMAP_FILE="$2"; shift ;;
    --enroll-key) ENROLL_KEY="$2"; shift ;;
    --enroll-via) ENROLL_VIA="$2"; shift ;;
    --trust-new-hostkeys) SHK="accept-new" ;;
    --since) SINCE="$2"; shift ;;
    --parallel) PAR="$2"; shift ;;
    --pre-hook) PRE_HOOK="$2"; shift ;;
    --no-snapshot) NO_SNAP=1 ;;
    --keep-going) KEEP_GOING=1 ;;
    --inventory) INV_FILE="$2"; shift ;;
    --out) OUT="$2"; shift ;;
    --list) LIST_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "opcao desconhecida: $1 (use --help)" ;;
  esac
  shift
done

load_inventory() {
  if [ -n "$INV_FILE" ]; then cat "$INV_FILE"; else inventory_builtin; fi | grep -vE '^[[:space:]]*(#|$)'
}

if [ "$LIST_ONLY" = 1 ]; then
  { echo "NOME|IP|PORTA|FLAG|NOTA|ALIAS"; load_inventory; } | column -t -s'|' 2>/dev/null || load_inventory
  exit 0
fi

OUT="${OUT:-./php-cve-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT/raw" || die "nao consegui criar $OUT"
: > "$OUT/run.log"

MUTATING=0; case "$MODE" in mitigate|unmitigate|patch|enroll) MUTATING=1 ;; esac
if [ "$MUTATING" = 1 ] && [ "$APPLY" != 1 ]; then die "modo '$MODE' altera servidores: exige --apply"; fi
if [ "$MODE" = patch ] && [ -z "$PRE_HOOK" ] && [ "$NO_SNAP" != 1 ]; then
  die "patch exige --pre-hook (snapshot) ou --no-snapshot (voce assume o risco)"
fi
command -v ssh >/dev/null 2>&1 || die "ssh nao encontrado"
command -v timeout >/dev/null 2>&1 || die "timeout (coreutils) nao encontrado"

# selecao de hosts
declare -a HOSTS=()
only_lc=$(echo "$ONLY" | tr 'A-Z' 'a-z')
declare -A FOUND=()
while IFS= read -r line; do
  IFS='|' read -r name ip port flag note alias <<<"$line"
  [ -n "$name" ] || continue
  lc=$(echo "$name" | tr 'A-Z' 'a-z')
  if [ -n "$only_lc" ]; then
    case ",$only_lc," in *",$lc,"*) FOUND[$lc]=1 ;; *) continue ;; esac
  else
    case "$flag" in
      explicit) [ "$INC_EXPL" = 1 ] || continue ;;
      skip)     [ "$INC_SKIP" = 1 ] || continue ;;
    esac
  fi
  HOSTS+=("$name|$ip|${port:-6650}|${flag:-run}|$note|$alias")
done < <(load_inventory)
if [ -n "$only_lc" ]; then
  for n in ${only_lc//,/ }; do [ -n "${FOUND[$n]:-}" ] || echo "AVISO: '$n' nao existe no inventario" >&2; done
fi
[ "${#HOSTS[@]}" -gt 0 ] || die "nenhum host selecionado"
if [ "$CANARY" = 1 ]; then HOSTS=("${HOSTS[0]}"); fi

log "ibr-php-cve v$VERSION | modo=$MODE | hosts=${#HOSTS[@]} | saida=$OUT | corte IOC=$SINCE"
if [ "$MUTATING" = 1 ] && [ "$YES" != 1 ]; then
  echo; echo "Hosts alvo ($MODE):"; for h in "${HOSTS[@]}"; do echo "  - ${h%%|*}"; done; echo
  if [ -t 0 ]; then read -r -p "Digite SIM para continuar: " ans; [ "$ans" = "SIM" ] || die "cancelado"
  else die "sem terminal: use --yes"; fi
fi

# ---- acesso ----
OPTS=()
HOSTKEY=""
declare -A KEYMAP=()
if [ -n "$KEYMAP_FILE" ]; then
  [ -r "$KEYMAP_FILE" ] || die "keymap ilegivel: $KEYMAP_FILE"
  while IFS='|' read -r km_name km_path; do
    case "$km_name" in ''|'#'*) continue ;; esac
    km_path="${km_path/#\~/$HOME}"
    [ -r "$km_path" ] || echo "AVISO: chave do keymap nao encontrada: $km_path ($km_name)" >&2
    KEYMAP[$(echo "$km_name" | tr 'A-Z' 'a-z')]="$km_path"
  done < "$KEYMAP_FILE"
fi
build_opts() {  # porta
  OPTS=(-p "$1" -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=6
        -o PasswordAuthentication=no -o StrictHostKeyChecking="$SHK" -o LogLevel=ERROR)
  if [ -n "$HOSTKEY" ]; then OPTS+=(-i "$HOSTKEY" -o IdentitiesOnly=yes); fi
}
clean_msg() { tr -d '\r' | tr -cd '[:print:]\n' | grep -v '^[[:space:]]*$' | tail -n1 | cut -c1-110; }
probe_access() {  # ip porta -> ACC_USER ACC_SUDO ACC_ERR
  local u out rc msg
  ACC_USER=""; ACC_SUDO=""; ACC_ERR=""; ACC_KIND="other"
  build_opts "$2"
  for u in ${USERS//,/ }; do
    out=$(ssh -n "${OPTS[@]}" "$u@$1" 'if [ "$(id -u)" = 0 ]; then echo SUDO=root; elif sudo -n true 2>/dev/null; then echo SUDO=yes; else echo SUDO=no; fi' 2>&1); rc=$?
    if [ $rc -eq 0 ] && grep -q '^SUDO=' <<<"$out"; then
      ACC_USER="$u"; ACC_SUDO=$(grep '^SUDO=' <<<"$out" | head -n1 | cut -d= -f2); return 0
    fi
    msg=$(clean_msg <<<"$out")
    case "$out" in
      *"IDENTIFICATION HAS CHANGED"*) ACC_KIND=changed; msg="CHAVE DO HOST ALTERADA: nao conectar, verificar por canal confiavel" ;;
      *"host key is known"*|*"Host key verification failed"*) ACC_KIND=hostkey; msg="host key ausente no known_hosts para este IP:porta (use --trust-new-hostkeys)" ;;
      *"timed out"*|*"No route"*|*"refused"*|*"Could not resolve"*) ACC_KIND=net ;;
      *"Permission denied"*) ACC_KIND=denied; msg="$u: chave nao autorizada (metodos: $(grep -o '(.*)' <<<"$out" | tr -cd '[:print:]' | head -n1))" ;;
    esac
    ACC_ERR="${ACC_ERR:+$ACC_ERR; }$msg"
    case "$out" in
      *"timed out"*|*"No route"*|*"refused"*|*"IDENTIFICATION HAS CHANGED"*|*"host key is known"*|*"Host key verification failed"*|*"Could not resolve"*) return 1 ;;
    esac
  done
  return 1
}

process_host() {
  local line="$1" name ip port flag note alias target raw
  IFS='|' read -r name ip port flag note alias <<<"$line"
  target="${alias:-$ip}"
  raw="$OUT/raw/$name.txt"
  local lcn; lcn=$(echo "$name" | tr 'A-Z' 'a-z')
  HOSTKEY="${KEYMAP[$lcn]:-${KEYMAP[$(echo "$target" | tr 'A-Z' 'a-z')]:-${KEYMAP[$ip]:-$KEY}}}"
  if ! probe_access "$target" "$port"; then
    echo "FAIL|${ACC_ERR:-sem resposta}" > "$OUT/raw/$name.access"; : > "$raw"
    log "$name ($target:$port): SEM ACESSO - ${ACC_ERR:-sem resposta}"; return 2
  fi
  echo "OK|$ACC_USER|$ACC_SUDO" > "$OUT/raw/$name.access"
  if [ "$MUTATING" = 1 ] && [ "$ACC_SUDO" = no ]; then
    echo "ERR|sem sudo -n para $ACC_USER: nao ha mutacao possivel" > "$raw"
    log "$name: usuario $ACC_USER sem sudo -n; pulado"; return 2
  fi
  if [ "$MODE" = patch ] && [ -n "$PRE_HOOK" ]; then
    if ! bash -c "$PRE_HOOK \"\$1\" \"\$2\"" _ "$name" "$ip" >> "$OUT/run.log" 2>&1; then
      echo "ERR|pre-hook falhou: host pulado" > "$raw"; log "$name: pre-hook falhou; pulado"; return 2
    fi
  fi
  local pre=""; [ "$ACC_SUDO" = yes ] && pre="sudo -n "
  log "$name ($target:$port) como $ACC_USER [sudo=$ACC_SUDO]: $MODE ..."
  build_opts "$port"
  remote_payload | timeout "$HOST_TIMEOUT" ssh "${OPTS[@]}" "$ACC_USER@$target" \
      "${pre}env IBR_MODE=$MODE IBR_SINCE=$SINCE bash -s" > "$raw" 2> "$raw.err"
  local rc=$?
  if [ $rc -ne 0 ] || ! grep -q '^DONE|' "$raw"; then
    echo "ERR|execucao remota incompleta (rc=$rc): $(tr '\n|' '  ' < "$raw.err" | cut -c1-160)" >> "$raw"
    log "$name: execucao incompleta (rc=$rc)"; return 3
  fi
  log "$name: concluido"
  return 0
}

enroll_flow() {
  local k pub h name ip port flag note alias target u ok vkey via=() n_ok=0 n_fail=0 n_skip=0 n_already=0
  k="${ENROLL_KEY:-$HOME/.ssh/ibr_ops_ed25519}"; k="${k/#\~/$HOME}"
  command -v ssh-copy-id >/dev/null 2>&1 || die "ssh-copy-id nao encontrado"
  if [ ! -t 0 ] && [ -z "$ENROLL_VIA" ] && [ "${#KEYMAP[@]}" -eq 0 ]; then die "enroll por senha exige terminal interativo (ou use --enroll-via / --keymap com chaves que ja entram)"; fi
  if [ ! -f "$k" ]; then
    echo "Gerando a chave dedicada $k (defina uma passphrase forte: ela da acesso a toda a frota)..."
    ssh-keygen -t ed25519 -C "ibr-ops@$(hostname -s)-$(date +%Y%m%d)" -f "$k" || die "falha ao gerar a chave"
  fi
  [ -f "$k.pub" ] || ssh-keygen -y -f "$k" > "$k.pub" || die "sem chave publica"
  ssh-add "$k" 2>/dev/null || true
  pub="$k.pub"
  log "enroll: cadastrando $(ssh-keygen -lf "$pub" | cut -d' ' -f1-2) | usuarios: $USERS"
  for h in "${HOSTS[@]}"; do
    IFS='|' read -r name ip port flag note alias <<<"$h"
    target="${alias:-$ip}"; HOSTKEY="$k"
    if probe_access "$target" "$port"; then log "$name: ja aceita a chave (nada a fazer)"; n_already=$((n_already+1)); continue; fi
    if [ "$ACC_KIND" != denied ]; then log "$name: PULADO - $ACC_ERR"; n_skip=$((n_skip+1)); continue; fi
    ok=0; via=()
    vkey="${KEYMAP[$(echo "$name" | tr 'A-Z' 'a-z')]:-${KEYMAP[$(echo "$target" | tr 'A-Z' 'a-z')]:-$ENROLL_VIA}}"
    if [ -n "$vkey" ]; then via=(-o "IdentityFile=${vkey/#\~/$HOME}" -o IdentitiesOnly=yes); fi
    for u in ${USERS//,/ }; do
      log "$name ($target:$port): instalando a chave para o usuario $u ..."
      ssh-copy-id -i "$pub" -p "$port" -o StrictHostKeyChecking="$SHK" -o ConnectTimeout=8 -o NumberOfPasswordPrompts=1 "${via[@]}" "$u@$target"
      if probe_access "$target" "$port"; then log "$name: ENROLADO como $ACC_USER [sudo=$ACC_SUDO]"; ok=1; n_ok=$((n_ok+1)); break; fi
    done
    if [ "$ok" = 0 ]; then
      log "$name: FALHOU - se o host so aceita chave publica, use --enroll-via com uma chave que ja entra, ou o console do provedor"
      n_fail=$((n_fail+1))
    fi
  done
  log "ENROLL: ok=$n_ok ja_ok=$n_already falhou=$n_fail pulado=$n_skip"
  echo "Proximo passo: $0 discover --key $k"
  echo "Revogar depois: nos hosts, remova de ~/.ssh/authorized_keys a linha com o comentario '$(awk '{print $3}' "$pub")'"
  [ "$n_fail" -eq 0 ] || exit 3
  exit 0
}

if [ "$MODE" = enroll ]; then enroll_flow; fi

STATUS=0
if [ "$MUTATING" = 1 ]; then
  for h in "${HOSTS[@]}"; do
    process_host "$h"; rc=$?
    n=${h%%|*}
    if grep -qE '^(PATCH\|(FAILED|ROLLED_BACK|ROLLBACK_FAILED)|MITIGATE\|(FAILED|PARTIAL)|ERR\|)' "$OUT/raw/$n.txt" 2>/dev/null || [ $rc -ne 0 ]; then
      STATUS=3
      if [ "$KEEP_GOING" != 1 ]; then log "PARANDO apos falha em $n (use --keep-going para continuar)"; break; fi
    fi
  done
else
  for h in "${HOSTS[@]}"; do
    while [ "$(jobs -rp | wc -l)" -ge "$PAR" ]; do sleep 0.3; done
    process_host "$h" &
  done
  wait
fi

# ---- relatorio ----
SUMMARY="$OUT/summary.tsv"; IOCF="$OUT/ioc.txt"
printf 'HOST\tIP\tACESSO\tIP_PUBLICO\tPORTAS_WEB\tPHP_SERVINDO\tSTATUS_CVE\tSTALE\tIOC_ARQ_SUSPEITOS\tIOC_CRASHES\tIOC_PROCS\tMITIGACAO\tPATCH\n' > "$SUMMARY"
: > "$IOCF"
for h in "${HOSTS[@]}"; do
  IFS='|' read -r name ip port flag note alias <<<"$h"
  raw="$OUT/raw/$name.txt"; acc="SEM_ARQUIVO"
  [ -f "$OUT/raw/$name.access" ] && acc=$(cut -d'|' -f1-3 "$OUT/raw/$name.access" | tr -cd '[:print:]' | tr '| ' ':_' | cut -c1-48)
  if [ "${acc%%:*}" != OK ]; then
    printf '%s\t%s\t%s\t-\t-\t-\tSEM_ACESSO\t-\t-\t-\t-\t-\t-\n' "$name" "$ip" "$acc" >> "$SUMMARY"; continue
  fi
  awk -F'|' -v n="$name" -v ip="$ip" -v acc="$acc" '
    function rk(s){ if(s=="VULNERABLE"||s=="EOL_NO_FIX")return 6; if(s=="NEEDS_BACKPORT")return 5; if(s ~ /^UNKNOWN/)return 4; if(s ~ /^FIXED/)return 1; return 3 }
    $1=="PHASE"{ ns=0; na=0; ws=0; wa=0; wsl=""; wal=""; vers=""; stale=0; delete seen }
    $1=="HOST"{ pub=$6; ports=$7 }
    $1=="BIN"||$1=="CONT"{
      if($1=="BIN"){ver=$4; sv=$6; st=$7} else {ver=$5; sv="yes"; st=$6}
      na++; if(rk(st)>wa){wa=rk(st); wal=st}
      if(sv=="yes"||sv=="?"){ ns++; if(rk(st)>ws){ws=rk(st); wsl=st}
        if(!(ver in seen)){seen[ver]=1; vers=vers (vers==""?"":",") ver} }
    }
    $1=="STALE"{stale++}
    $1=="IOC_FILE"&&$2=="SUSPECT"{isf++}
    $1=="IOC_BINPATH"{ibp++}
    $1=="IOC_CRASH"{crash=$2}
    $1=="IOC_PROC"{iproc++}
    $1=="MITIGATE"&&$2!="WROTE"&&$2!="REMOVED"{mit=$2}
    $1=="PATCH"&&$2!="INFO"&&$2!="WARN"{pat=$2}
    END{
      if(na==0) status="NO_PHP"; else if(ns>0) status=wsl; else status=wal "(nao_servindo)";
      printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%d\t%d\t%d\t%d\t%s\t%s\n", n, ip, acc, (pub==""?"nao":pub), (ports==""?"-":ports),
             (vers==""?"-":vers), status, stale, isf+ibp, crash+0, iproc+0, (mit==""?"-":mit), (pat==""?"-":pat)
    }' "$raw" >> "$SUMMARY"
  grep -E '^(IOC_|STALE\||ERR\|)' "$raw" | sed "s/^/$name|/" >> "$IOCF"
done

echo
if command -v column >/dev/null 2>&1; then column -t -s$'\t' "$SUMMARY"; else cat "$SUMMARY"; fi
echo
n_vuln=$(awk -F'\t' 'NR>1 && ($7 ~ /^(VULNERABLE|EOL_NO_FIX|NEEDS_BACKPORT)/){c++} END{print c+0}' "$SUMMARY")
n_ioc=$(awk -F'\t' 'NR>1 && ($9>0 || $11>0){c++} END{print c+0}' "$SUMMARY")
n_fail=$(awk -F'\t' 'NR>1 && $7=="SEM_ACESSO"{c++} END{print c+0}' "$SUMMARY")
n_stale=$(awk -F'\t' 'NR>1 && $8>0{c++} END{print c+0}' "$SUMMARY")
log "RESUMO: vulneraveis/EOL=$n_vuln | stale=$n_stale | com IOC=$n_ioc | sem acesso=$n_fail | de ${#HOSTS[@]} hosts"
echo "Arquivos: $SUMMARY  $IOCF  $OUT/raw/"
case "$MODE" in
  discover)
    echo "IOC e heuristica: arquivo .php novo pode ser deploy legitimo. Se houver SUSPECT/IOC_PROC em host publico, trate como incidente ANTES de patchear (preserve evidencias)."
    [ "$n_vuln" -gt 0 ] && echo "Proximo passo: $0 patch --apply --canary --no-snapshot --only <host>   (EOL/backport: mitigate + isolamento)" ;;
  mitigate) echo "Mitigacao e provisoria e NAO corrige o CVE. Faca o patch e depois 'unmitigate'." ;;
esac
[ "$STATUS" -ne 0 ] && exit "$STATUS"
{ [ "$n_vuln" -gt 0 ] || [ "$n_ioc" -gt 0 ]; } && exit 2
exit 0
