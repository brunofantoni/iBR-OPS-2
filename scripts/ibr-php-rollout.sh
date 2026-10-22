#!/usr/bin/env bash
# =============================================================================
#  ibr-php-rollout.sh  v1.0.0
#  IBR Cloud Services | Orquestrador da resposta ao php2shell (CVE-2026-109618 / 109619)
#
#  Script unico que encadeia o ibr-php-cve.sh (mesmo diretorio):
#    1. discover + sites (somente leitura, em paralelo)  -> baseline e IOC
#    2. plano: o que sera atualizado, mitigado, travado por IOC ou sem acesso
#    3. [--apply]    mitigate (opcional) -> patch no CANARIO -> patch no resto
#    4. sites de novo nos hosts alterados                -> comparativo antes/depois
#    5. relatorio.md + pendencias.tsv
#
#  SEM --apply NADA E ALTERADO: roda so as fases de leitura e imprime o plano.
#
#  REGRAS DE SEGURANCA (nao sao opcionais)
#    - Host com IOC (arquivo/binario suspeito ou processo) NAO e atualizado: patch troca
#      binarios e reinicia servicos, o que destroi evidencia. Trate como incidente primeiro.
#      Excecao consciente: --ioc-override HOST[,HOST]
#    - Canario primeiro; se falhar, o resto nao roda. Rollback e do ibr-php-cve.sh
#      (dnf history undo / apt downgrade) e acontece sozinho se o HTTP piorar.
#    - IBR-WEB008 hospeda o MySQL do IBR Ops: so entra com --web008-backup-ok (voce afirma que
#      o backup do banco foi feito) e SEMPRE por ultimo.
#    - --apply exige --pre-hook (snapshot) ou --no-snapshot (voce assume o risco).
#    - Patch so atualiza dentro da mesma serie (ex.: 8.3.29 -> 8.3.36). 7.4, 8.0 e 8.1 nao
#      tem correcao oficial: para eles o unico controle e --mitigate + migracao para 8.3.36+.
#
#  OPCOES
#    --apply                autoriza escrita
#    --yes                  nao pede a confirmacao SIM
#    --mitigate             (com --apply) aplica a mitigacao session.upload_progress=0 nos
#                           hosts que ainda terao PHP sem correcao (NEEDS_BACKPORT / EOL)
#    --canary HOST          host do canario (padrao: IBR-MAUTIC01 se estiver no plano)
#    --only a,b             hosts (padrao: os 10 do ultimo scan, incluindo IBR-WEB008)
#    --web008-backup-ok     libera IBR-WEB008 para escrita (por ultimo)
#    --ioc-override a,b     libera host travado por IOC (voce assume a perda de evidencia)
#    --pre-hook CMD         snapshot local antes de cada host (recebe NOME e IP)
#    --no-snapshot          patch sem snapshot
#    --key PATH             chave SSH (ou use ssh-agent)
#    --out DIR              diretorio de saida (padrao ./php-rollout-AAAAMMDD-HHMMSS)
#    --  ...                demais argumentos repassados ao ibr-php-cve.sh
#                           (ex.: -- --trust-new-hostkeys --keymap arquivo --user infrabrasil)
#    -h, --help
#
#  EXEMPLOS
#    ./ibr-php-rollout.sh --key ~/.ssh/ibr_ops_ed25519                       # so plano e relatorio
#    ./ibr-php-rollout.sh --key ~/.ssh/ibr_ops_ed25519 --apply --mitigate --no-snapshot
#    ./ibr-php-rollout.sh --key ~/.ssh/ibr_ops_ed25519 --apply --web008-backup-ok --pre-hook ./snap.sh
#
#  Codigo de saida: 0 = nada pendente | 2 = pendencias (ver relatorio) | 3 = falha de execucao
# =============================================================================
set -o pipefail

[ "${BASH_VERSINFO[0]:-0}" -ge 4 ] || { echo "ERRO: bash 4+ necessario (macOS: brew install bash e PATH com \$(brew --prefix)/bin)" >&2; exit 1; }

VERSION="1.0.0"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CVE="${IBR_CVE_SCRIPT:-$HERE/ibr-php-cve.sh}"
DEFAULT_ONLY="IBR-WEB015,IBR-WEB008,IBR-MAUTIC01,HD1WEB1,GUIO002,CREA-AM,CRT-RJ-WEB-01,CRECI-DF-WEB-01,CRECI-DF-APP-01,WEB020"

APPLY=0; YES=0; MITIGATE=0; CANARY=""; ONLY="$DEFAULT_ONLY"; WEB008_OK=0; IOC_OVR=""
PRE_HOOK=""; NO_SNAP=0; OUT=""
declare -a PASS=()

usage() { sed -n '3,/^# =====/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
die() { echo "ERRO: $*" >&2; exit 1; }
lc() { echo "$1" | tr 'A-Z' 'a-z'; }
in_csv() { case ",$(lc "$1")," in *",$(lc "$2"),"*) return 0 ;; esac; return 1; }
to_csv() { paste -sd',' - ; }

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --yes) YES=1 ;;
    --mitigate) MITIGATE=1 ;;
    --canary) CANARY="$2"; shift ;;
    --only) ONLY="$2"; shift ;;
    --web008-backup-ok) WEB008_OK=1 ;;
    --ioc-override) IOC_OVR="$2"; shift ;;
    --pre-hook) PRE_HOOK="$2"; shift ;;
    --no-snapshot) NO_SNAP=1 ;;
    --key) PASS+=(--key "$2"); shift ;;
    --out) OUT="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    --) shift; PASS+=("$@"); break ;;
    *) die "opcao desconhecida: $1 (use --help)" ;;
  esac
  shift
done

[ -x "$CVE" ] || [ -f "$CVE" ] || die "ibr-php-cve.sh nao encontrado em $CVE"
if [ "$APPLY" = 1 ] && [ -z "$PRE_HOOK" ] && [ "$NO_SNAP" != 1 ]; then
  die "--apply exige --pre-hook (snapshot) ou --no-snapshot (voce assume o risco)"
fi
if [ "$MITIGATE" = 1 ] && [ "$APPLY" != 1 ]; then die "--mitigate so faz sentido com --apply"; fi

OUT="${OUT:-./php-rollout-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT" || die "nao consegui criar $OUT"
: > "$OUT/rollout.log"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/rollout.log"; }

# chama o ibr-php-cve.sh; stdout/stderr vao para <fase>.log; devolve o codigo dele
run_cve() {  # fase modo args...
  local ph="$1" mode="$2"; shift 2
  "$CVE" "$mode" "$@" "${PASS[@]}" --out "$OUT/$ph" > "$OUT/$ph.log" 2>&1
  return $?
}

# ---------------------------------------------------------------------------
# Fase 1: baseline (somente leitura)
# ---------------------------------------------------------------------------
log "ibr-php-rollout v$VERSION | apply=$APPLY | hosts=$ONLY | saida=$OUT"
log "fase 1: discover + sites em paralelo (somente leitura; costuma levar ~10 min). Acompanhe: tail -f $OUT/1-discover/run.log"
run_cve 1-discover discover --only "$ONLY" & PID_D=$!
run_cve 2-sites-antes sites --only "$ONLY" & PID_S=$!
wait "$PID_D"; RC_D=$?
wait "$PID_S"; RC_S=$?
case "$RC_D" in 0|2) ;; *) tail -n 20 "$OUT/1-discover.log" >&2; die "discover falhou (rc=$RC_D); veja $OUT/1-discover.log" ;; esac
case "$RC_S" in 0|2) ;; *) tail -n 20 "$OUT/2-sites-antes.log" >&2; die "sites falhou (rc=$RC_S); veja $OUT/2-sites-antes.log" ;; esac

SUM="$OUT/1-discover/summary.tsv"
SITES_B="$OUT/2-sites-antes/sites.tsv"
[ -s "$SUM" ] || die "discover nao gerou summary.tsv"
[ -s "$SITES_B" ] || die "sites nao gerou sites.tsv"

# ---------------------------------------------------------------------------
# Fase 2: plano
# ---------------------------------------------------------------------------
NOACC=$(awk -F'\t' 'NR>1 && $7=="SEM_ACESSO"{print $1}' "$SUM")
IOCH=$(awk -F'\t' 'NR>1 && $7!="SEM_ACESSO" && ($9>0 || $10>0 || $12>0){print $1}' "$SUM")
PATCHC=$(awk -F'\t' 'NR>1 && $7 ~ /^(VULNERABLE|NEEDS_BACKPORT)$/{print $1}' "$SUM")
MITC=$(awk -F'\t' 'NR>1 && $7 ~ /^(NEEDS_BACKPORT|EOL_NO_FIX)$/{print $1}' "$SUM")

PATCH_SET=(); BLOCK_IOC=(); BLOCK_W008=(); MIT_SET=()
for h in $PATCHC; do
  if in_csv "$IOC_OVR" "$h"; then :; elif echo "$IOCH" | grep -qix "$h"; then BLOCK_IOC+=("$h"); continue; fi
  if [ "$(lc "$h")" = "ibr-web008" ] && [ "$WEB008_OK" != 1 ]; then BLOCK_W008+=("$h"); continue; fi
  PATCH_SET+=("$h")
done
for h in $MITC; do
  if [ "$(lc "$h")" = "ibr-web008" ] && [ "$WEB008_OK" != 1 ]; then continue; fi
  MIT_SET+=("$h")
done

# canario: o escolhido, senao IBR-MAUTIC01, senao o primeiro do plano
CAN=""
if [ "${#PATCH_SET[@]}" -gt 0 ]; then
  if [ -n "$CANARY" ]; then
    for h in "${PATCH_SET[@]}"; do [ "$(lc "$h")" = "$(lc "$CANARY")" ] && CAN="$h"; done
    [ -n "$CAN" ] || die "canario '$CANARY' nao esta no plano de patch (${PATCH_SET[*]})"
  else
    for h in "${PATCH_SET[@]}"; do [ "$(lc "$h")" = "ibr-mautic01" ] && CAN="$h"; done
    if [ -z "$CAN" ]; then
      for h in "${PATCH_SET[@]}"; do [ "$(lc "$h")" != "ibr-web008" ] && { CAN="$h"; break; }; done
    fi
    [ -n "$CAN" ] || CAN="${PATCH_SET[0]}"
  fi
fi
REST=(); W008=()
for h in "${PATCH_SET[@]}"; do
  [ "$h" = "$CAN" ] && continue
  if [ "$(lc "$h")" = "ibr-web008" ]; then W008+=("$h"); else REST+=("$h"); fi
done
[ "$(lc "$CAN")" = "ibr-web008" ] && { W008=("$CAN"); CAN=""; }

echo
echo "================ PLANO ================"
if command -v column >/dev/null 2>&1; then column -t -s$'\t' "$SUM" | cut -c1-200; else cat "$SUM"; fi
echo
printf 'Patch (canario)    : %s\n' "${CAN:--}"
printf 'Patch (restante)   : %s\n' "${REST[*]:--}"
printf 'Patch (WEB008 ult.): %s\n' "${W008[*]:--}"
printf 'Mitigar            : %s\n' "$([ "$MITIGATE" = 1 ] && echo "${MIT_SET[*]:--}" || echo "(nao pedido: use --mitigate) candidatos: ${MIT_SET[*]:--}")"
printf 'TRAVADO por IOC    : %s\n' "${BLOCK_IOC[*]:--}"
printf 'WEB008 sem backup  : %s\n' "${BLOCK_W008[*]:--}"
printf 'Sem acesso         : %s\n' "$(echo "$NOACC" | tr '\n' ' ')"
echo "======================================="
echo
log "plano: canario=${CAN:--} resto=${REST[*]:--} web008=${W008[*]:--} ioc=${BLOCK_IOC[*]:--} sem_acesso=$(echo "$NOACC" | tr '\n' ' ')"

# ---------------------------------------------------------------------------
# Fase 3: execucao (so com --apply)
# ---------------------------------------------------------------------------
SNAP=(); if [ -n "$PRE_HOOK" ]; then SNAP=(--pre-hook "$PRE_HOOK"); else SNAP=(--no-snapshot); fi
STATUS=0
CHANGED=()
declare -A PRES=()
addres() { PRES[$1]="${PRES[$1]:+${PRES[$1]} ; }$2"; }

patch_ok() {  # host fase -> 0 se o ibr-php-cve registrou PATCH OK/NOOP
  grep -qE '^PATCH\|(OK|OK_STILL_VULNERABLE|NOOP)\|' "$OUT/$2/raw/$1.txt" 2>/dev/null
}

if [ "$APPLY" = 1 ]; then
  if [ "${#PATCH_SET[@]}" -eq 0 ] && { [ "$MITIGATE" != 1 ] || [ "${#MIT_SET[@]}" -eq 0 ]; }; then
    log "nada a alterar: nenhum host elegivel"
  else
    if [ "$YES" != 1 ]; then
      if [ -t 0 ]; then read -r -p "Digite SIM para aplicar o plano acima: " ans; [ "$ans" = "SIM" ] || die "cancelado"
      else die "sem terminal: use --yes"; fi
    fi

    if [ "$MITIGATE" = 1 ] && [ "${#MIT_SET[@]}" -gt 0 ]; then
      log "fase 3a: mitigate em ${MIT_SET[*]}"
      run_cve 3a-mitigate mitigate --apply --yes --keep-going --only "$(printf '%s\n' "${MIT_SET[@]}" | to_csv)"; rc=$?
      for h in "${MIT_SET[@]}"; do
        CHANGED+=("$h")
        addres "$h" "$(grep -E '^MITIGATE\|(OK|NOOP|PARTIAL|FAILED)' "$OUT/3a-mitigate/raw/$h.txt" 2>/dev/null | tail -n1 | cut -c1-120)"
      done
      [ "$rc" -eq 0 ] || { STATUS=3; log "mitigate terminou com falha em algum host (rc=$rc); veja $OUT/3a-mitigate.log"; }
    fi

    if [ -n "$CAN" ]; then
      log "fase 3b: patch no CANARIO $CAN"
      run_cve 3b-canario patch --apply --yes --only "$CAN" "${SNAP[@]}"; rc=$?
      CHANGED+=("$CAN")
      addres "$CAN" "$(grep -E '^PATCH\|' "$OUT/3b-canario/raw/$CAN.txt" 2>/dev/null | grep -v '|INFO|' | tail -n1 | cut -c1-140)"
      if [ "$rc" -ne 0 ] || ! patch_ok "$CAN" 3b-canario; then
        STATUS=3; log "CANARIO FALHOU em $CAN: o restante NAO foi executado. Veja $OUT/3b-canario.log"
        REST=(); W008=()
      else
        log "canario ok: $(grep -E '^PATCH\|' "$OUT/3b-canario/raw/$CAN.txt" | grep -v '|INFO|' | tail -n1 | cut -c1-140)"
      fi
    fi

    if [ "${#REST[@]}" -gt 0 ]; then
      log "fase 3c: patch em ${REST[*]}"
      run_cve 3c-resto patch --apply --yes --only "$(printf '%s\n' "${REST[@]}" | to_csv)" "${SNAP[@]}"; rc=$?
      for h in "${REST[@]}"; do
        CHANGED+=("$h")
        addres "$h" "$(grep -E '^PATCH\|' "$OUT/3c-resto/raw/$h.txt" 2>/dev/null | grep -v '|INFO|' | tail -n1 | cut -c1-140)"
      done
      if [ "$rc" -ne 0 ]; then
        STATUS=3; log "patch parou em falha (rc=$rc); hosts seguintes nao rodaram. Veja $OUT/3c-resto.log"; W008=()
      fi
    fi

    if [ "${#W008[@]}" -gt 0 ]; then
      log "fase 3d: patch em ${W008[*]} (por ultimo, com backup do banco confirmado por voce)"
      run_cve 3d-web008 patch --apply --yes --only "$(printf '%s\n' "${W008[@]}" | to_csv)" "${SNAP[@]}"; rc=$?
      for h in "${W008[@]}"; do
        CHANGED+=("$h")
        addres "$h" "$(grep -E '^PATCH\|' "$OUT/3d-web008/raw/$h.txt" 2>/dev/null | grep -v '|INFO|' | tail -n1 | cut -c1-140)"
      done
      [ "$rc" -eq 0 ] || { STATUS=3; log "patch da WEB008 falhou (rc=$rc). Veja $OUT/3d-web008.log"; }
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Fase 4: sites depois (so nos hosts alterados)
# ---------------------------------------------------------------------------
SITES_A=""
if [ "${#CHANGED[@]}" -gt 0 ]; then
  CH_CSV=$(printf '%s\n' "${CHANGED[@]}" | sort -u | to_csv)
  log "fase 4: sites nos hosts alterados ($CH_CSV)"
  run_cve 4-sites-depois sites --only "$CH_CSV"; rc=$?
  case "$rc" in 0|2) SITES_A="$OUT/4-sites-depois/sites.tsv" ;; *) log "sites (depois) falhou rc=$rc; veja $OUT/4-sites-depois.log"; STATUS=3 ;; esac
  [ -s "$SITES_A" ] || SITES_A=""
fi

# ---------------------------------------------------------------------------
# Fase 5: relatorio
# ---------------------------------------------------------------------------
REP="$OUT/relatorio.md"; PEND="$OUT/pendencias.tsv"
count_status() {  # sites.tsv hosts_csv
  awk -F'\t' -v hs=",$2," 'NR>1 && index(hs, "," $1 ",")>0 && $2 !~ /^(cpanel|mail|webmail)\./ && $2 !~ /(dummy-host|example\.com)/ {
         s=$6; if(s=="?" || $7 ~ /^versao nao detectada/) s="NAO_DETECTADA"; c[s]++ }
       END{for(k in c) printf "%s\t%d\n", k, c[k]}' "$1" | sort
}
ALL_CSV=$(awk -F'\t' 'NR>1{print $1}' "$SITES_B" | sort -u | to_csv)
{
  echo "# Rollout PHP (php2shell, CVE-2026-109618/109619)"
  echo
  echo "Gerado em $(date '+%Y-%m-%d %H:%M') por ibr-php-rollout v$VERSION | modo: $([ "$APPLY" = 1 ] && echo APLICADO || echo "SOMENTE PLANO (nada alterado)")"
  echo
  echo "## Hosts"
  echo
  echo "| Host | Status (servindo) | PHP servindo | IOC | Resultado |"
  echo "|---|---|---|---|---|"
  awk -F'\t' 'NR>1{printf "%s\t%s\t%s\t%s\n", $1,$7,$6,($7=="SEM_ACESSO"?"-":($9+$10+$12))}' "$SUM" | while IFS=$'\t' read -r h st v ioc; do
    r="${PRES[$h]:-}"
    if [ -z "$r" ]; then
      if echo "$IOCH" | grep -qix "$h" && ! in_csv "$IOC_OVR" "$h"; then r="TRAVADO por IOC (nao atualizado)"
      elif echo "$NOACC" | grep -qix "$h"; then r="sem acesso"
      elif [ "$(lc "$h")" = "ibr-web008" ] && [ "$WEB008_OK" != 1 ]; then r="aguardando --web008-backup-ok"
      else r="-"; fi
    fi
    r="${r//|/:}"
    echo "| $h | $st | $v | $ioc | $r |"
  done
  echo
  echo "## Sites por status (sem cpanel./mail./webmail./dummy)"
  echo
  if [ -n "$SITES_A" ]; then
    CH_LIST=$(printf '%s\n' "${CHANGED[@]}" | sort -u | to_csv)
    echo "Apenas nos hosts alterados ($CH_LIST):"
    echo
    echo "| Status | antes | depois |"
    echo "|---|---:|---:|"
    awk -F'\t' 'FNR==NR{b[$1]=$2; k[$1]=1; next} {a[$1]=$2; k[$1]=1} END{for(s in k) printf "| %s | %d | %d |\n", s, b[s]+0, a[s]+0}' \
      <(count_status "$SITES_B" "$CH_LIST") <(count_status "$SITES_A" "$CH_LIST") | sort
  else
    echo "Baseline (nada foi alterado):"
    echo
    echo "| Status | sites |"
    echo "|---|---:|"
    count_status "$SITES_B" "$ALL_CSV" | awk -F'\t' '{printf "| %s | %d |\n", $1, $2}'
  fi
  echo
  echo "## Binarios sem correcao encontrados (diagnostico)"
  echo
  echo "Use para separar versao instalada de binario avulso: um binario com serving=no ou pkg=source"
  echo "pode explicar versoes antigas que nao sao as que atendem o site."
  echo
  echo "| Host | Versao | SAPI | Pacote | Servindo | Caminho |"
  echo "|---|---|---|---|---|---|"
  for f in "$OUT"/1-discover/raw/*.txt; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .txt)
    awk -F'|' -v n="$n" '$1=="BIN" && ($7=="VULNERABLE"||$7=="NEEDS_BACKPORT"||$7=="EOL_NO_FIX"){printf "| %s | %s | %s | %s | %s | %s |\n", n,$4,$3,$5,$6,$2}' "$f"
  done | sort -u
  echo
  echo "## IOC"
  echo
  if [ -s "$OUT/1-discover/ioc.txt" ] && grep -qE '\|IOC_' "$OUT/1-discover/ioc.txt"; then
    echo '```'
    grep -E '\|IOC_' "$OUT/1-discover/ioc.txt" | cut -c1-200 | head -n 40
    echo '```'
    echo
    echo "Hosts com IOC nao foram atualizados. Preserve evidencias (copia de disco/snapshot, logs) antes de qualquer mudanca."
  else
    echo "Nenhum IOC registrado no baseline."
  fi
  echo
  echo "## Pendencias"
  echo
  echo "Ver pendencias.tsv. Resumo:"
  echo "- NEEDS_BACKPORT / EOL_NO_FIX: sem correcao oficial. Migrar para 8.3.36+ e manter a mitigacao (--mitigate) ate la."
  echo "- NAO_DETECTADA: sites que o script nao conseguiu mapear; conferir no painel."
  echo "- Hosts sem acesso: ${NOACC:-nenhum}"
} > "$REP"

{
  printf 'HOST\tDOMINIO\tUSUARIO\tPHP_SITE\tPHP_REAL\tSTATUS_CVE\tACAO\tAPP\tDOCROOT\n'
  if [ -n "$SITES_A" ]; then
    # hosts alterados: situacao nova; demais hosts: baseline
    awk -F'\t' 'NR>1' "$SITES_A"
    awk -F'\t' -v hs=",$(printf '%s\n' "${CHANGED[@]}" | sort -u | to_csv)," 'NR>1 && index(hs, "," $1 ",")==0' "$SITES_B"
  else
    awk -F'\t' 'NR>1' "$SITES_B"
  fi | awk -F'\t' '$2 !~ /^(cpanel|mail|webmail)\./ && $2 !~ /(dummy-host|example\.com)/ && $6 !~ /^FIXED/ && $6 != "" '
} > "$PEND"
N_PEND=$(awk -F'\t' 'NR>1' "$PEND" | wc -l | tr -d ' ')

echo
cat "$REP"
echo
log "relatorio: $REP | pendencias: $PEND ($N_PEND linhas) | status=$STATUS"
if [ "$APPLY" != 1 ]; then
  echo
  echo "Nada foi alterado. Para aplicar o plano acima (canario primeiro):"
  echo "  $0 ${PASS[*]} --apply --mitigate --no-snapshot --only $ONLY"
  echo "  (troque --no-snapshot por --pre-hook ./seu_snapshot.sh; adicione --web008-backup-ok somente apos backup do MySQL do IBR Ops)"
fi

[ "$STATUS" -ne 0 ] && exit "$STATUS"
{ [ "$N_PEND" -gt 0 ] || [ "${#BLOCK_IOC[@]}" -gt 0 ]; } && exit 2
exit 0
