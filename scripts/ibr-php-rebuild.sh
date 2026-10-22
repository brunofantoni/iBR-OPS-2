#!/usr/bin/env bash
# ibr-php-rebuild.sh - recompila o PHP compilado do CWP (/opt/alt/php-fpmNN) na versao corrigida
#
# Por que: no CWP o PHP em /opt/alt/php-fpmNN e compilado do fonte; dnf nao atualiza.
# A correcao do php2shell (CVE-2026-109618/109619) exige recompilar na versao corrigida da MESMA serie
# (8.2.35, 8.3.36, 8.4.27, 8.5.12) e tambem corrige binarios quebrados por upgrade de libs (ex.: libavif.so.15).
#
# Modos (rodam do seu Mac, via ssh no host):
#   build   (padrao) baixa o fonte do php.net, confere o sha256, compila em STAGING (/opt/ibr-build)
#                    com as MESMAS opcoes do php atual (php-config --configure-options) e testa.
#                    NAO altera o PHP em producao. Roda em segundo plano no host (sobrevive a queda do ssh).
#   status           mostra o andamento/resultado do build.
#   swap             troca os binarios (com backup tar), roda php-fpm -t, recarrega a unit e confere.
#                    Se o -t falhar, restaura o backup e NAO recarrega. Exige --yes ou confirmacao SIM.
#
# Uso:
#   ./scripts/ibr-php-rebuild.sh build --host 192.168.211.5 --dir /opt/alt/php-fpm83 --version 8.3.36 --key ~/.ssh/ibr_ops_ed25519
#   ./scripts/ibr-php-rebuild.sh status --host ... --dir ... --version ... --key ...
#   ./scripts/ibr-php-rebuild.sh swap   --host ... --dir ... --version ... --key ... [--yes]
#
# Opcoes: --port 6650  --user infrabrasil  --jobs 4  (IBR_CONNECT_TIMEOUT=45 aumenta o timeout do ssh)
set -u
VERSION=1.0.0
MODE=build; HOST=""; PORT=6650; USER_=infrabrasil; KEY=""; DIR=""; PV=""; JOBS=4; YES=0

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

[ $# -gt 0 ] && case "$1" in build|status|swap) MODE="$1"; shift ;; esac
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --user) USER_="$2"; shift ;;
    --key) KEY="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    --version) PV="$2"; shift ;;
    --jobs) JOBS="$2"; shift ;;
    --yes) YES=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "opcao desconhecida: $1" ;;
  esac
  shift
done
[ -n "$HOST" ] && [ -n "$KEY" ] && [ -n "$DIR" ] && [ -n "$PV" ] || die "faltam --host --key --dir --version"
case "$DIR" in /opt/alt/php-fpm[0-9][0-9]) ;; *) die "--dir deve ser /opt/alt/php-fpmNN" ;; esac
case "$PV" in [0-9].[0-9].[0-9]|[0-9].[0-9].[0-9][0-9]) ;; *) die "--version invalida: $PV" ;; esac
case "$JOBS" in ''|*[!0-9]*) die "--jobs invalido" ;; esac
SERIE_DIR="${DIR##*php-fpm}"; SERIE_VER="${PV%.*}"; SERIE_VER="${SERIE_VER/./}"
[ "$SERIE_DIR" = "$SERIE_VER" ] || die "versao $PV nao pertence a serie de $DIR (troca de serie quebraria extensoes)"

SSH=(ssh -o BatchMode=yes -o ConnectTimeout="${IBR_CONNECT_TIMEOUT:-45}" -o ServerAliveInterval=30 -p "$PORT" -i "$KEY" -o IdentitiesOnly=yes "$USER_@$HOST")
ENVV="IBR_DIR=$DIR IBR_VER=$PV IBR_JOBS=$JOBS"

read -r -d '' PAYLOAD <<'PAYLOAD_EOF'
set -u
MODE=${IBR_MODE:-build}; PHPDIR=${IBR_DIR:?}; VER=${IBR_VER:?}; JOBS=${IBR_JOBS:-4}
NAME=$(basename "$PHPDIR"); BASE=/opt/ibr-build; WORK=$BASE/$NAME-$VER; STAGE=$WORK/stage
LOG=$WORK/build.log; ST=$WORK/STATUS; P=$PHPDIR/usr
say() { echo "[$(date +%H:%M:%S)] $*"; }
case "$MODE" in
build)
  mkdir -p "$WORK"; : > "$LOG"; echo RUNNING > "$ST"
  exec >> "$LOG" 2>&1
  fail() { echo "FAIL $*" > "$ST"; echo "FALHA: $*"; exit 1; }
  [ -x "$P/bin/php-config" ] || fail "php-config ausente em $P/bin"
  OPTS=$("$P/bin/php-config" --configure-options) || fail "php-config --configure-options"
  [ -n "$OPTS" ] || fail "opcoes de compilacao vazias"
  AVAIL=$(df -Pk "$BASE" | awk 'NR==2{print $4}')
  [ "${AVAIL:-0}" -gt 3000000 ] || fail "menos de 3GB livres em $BASE"
  cd "$WORK" || fail "cd $WORK"
  say "baixando php-$VER"
  curl -fsSLo "php-$VER.tar.xz" "https://www.php.net/distributions/php-$VER.tar.xz" || fail "download do fonte"
  SHA=$(curl -fsS "https://www.php.net/releases/index.php?json&version=$VER" | sed 's/}/}\n/g' | grep "php-$VER.tar.xz" | grep -oE '"sha256":"[0-9a-f]{64}"' | head -1 | grep -oE '[0-9a-f]{64}')
  [ -n "$SHA" ] || fail "nao obtive o sha256 oficial de $VER (versao inexistente?)"
  echo "$SHA  php-$VER.tar.xz" | sha256sum -c - || fail "sha256 do tarball nao confere"
  rm -rf src; mkdir src; tar -xJf "php-$VER.tar.xz" -C src --strip-components=1 || fail "tar"
  cd src || fail "cd src"
  say "configure (mesmas opcoes do php atual)"
  eval "./configure $OPTS" > ../configure.out 2>&1 || { tail -30 ../configure.out; fail "configure (veja $WORK/configure.out)"; }
  say "make -j$JOBS"
  nice -n 10 make -j"$JOBS" > ../make.out 2>&1 || { tail -30 ../make.out; fail "make (veja $WORK/make.out)"; }
  rm -rf "$STAGE"
  say "make install em staging"
  make install INSTALL_ROOT="$STAGE" > ../install.out 2>&1 || { tail -30 ../install.out; fail "make install (veja $WORK/install.out)"; }
  SP=$STAGE$P
  GOT=$("$SP/sbin/php-fpm" -v 2>&1 | head -1)
  echo "$GOT" | grep -q "PHP $VER" || fail "versao inesperada: $GOT"
  MISS=$(ldd "$SP/sbin/php-fpm" "$SP/bin/php" 2>&1 | grep 'not found')
  [ -z "$MISS" ] || fail "bibliotecas ausentes no binario novo: $MISS"
  "$SP/sbin/php-fpm" -t > ../teste.out 2>&1 || { tail -20 ../teste.out; fail "php-fpm -t do binario novo com a config real"; }
  for so in "$SP"/lib/php/extensions/*/*.so; do [ -f "$so" ] && ldd "$so" 2>&1 | grep -q 'not found' && echo "AVISO: extensao nova com lib ausente: $so"; done
  for so in "$P"/lib/php/extensions/*/*.so; do [ -f "$so" ] && ldd "$so" 2>&1 | grep -q 'not found' && echo "AVISO: extensao ATUAL em producao com lib ausente: $so"; done
  say "OK: $GOT"
  echo OK > "$ST"
  ;;
status)
  echo "STATUS: $(cat "$ST" 2>/dev/null || echo SEM_BUILD)"
  tail -n 15 "$LOG" 2>/dev/null
  ;;
swap)
  die() { echo "ERRO: $*"; exit 1; }
  [ "$(cat "$ST" 2>/dev/null)" = OK ] || die "build nao concluido com sucesso (rode build/status)"
  SP=$STAGE$P; TS=$(date +%Y%m%d-%H%M%S); BK=$WORK/backup-$TS.tar
  UNIT="php-fpm${NAME#php-fpm}.service"
  systemctl cat "$UNIT" >/dev/null 2>&1 || die "unit $UNIT nao encontrada"
  FILES=""
  for r in sbin/php-fpm bin/php bin/php-cgi bin/php-config bin/phpize bin/phar.phar; do
    [ -f "$SP/$r" ] && FILES="$FILES $r"
  done
  for f in "$SP"/lib/php/extensions/*/*.so; do
    [ -f "$f" ] && FILES="$FILES ${f#"$SP/"}"
  done
  [ -n "$FILES" ] || die "nada para trocar em $SP"
  EXIST=""; for r in $FILES; do [ -e "$P/$r" ] && EXIST="$EXIST ${P#/}/$r"; done
  OLD_BROKEN=0; ldd "$P/sbin/php-fpm" 2>&1 | grep -q 'not found' && OLD_BROKEN=1
  tar -cf "$BK" -C / $EXIST || die "backup falhou"
  say "backup: $BK"
  restore() { tar -xf "$BK" -C / && say "backup restaurado"; }
  for r in $FILES; do
    mkdir -p "$(dirname "$P/$r")"
    cp -p "$SP/$r" "$P/$r.ibr-new" && mv -f "$P/$r.ibr-new" "$P/$r" || { restore; die "falha ao trocar $r"; }
  done
  if ! "$P/sbin/php-fpm" -t >/dev/null 2>&1; then restore; die "php-fpm -t falhou apos a troca; backup restaurado, NADA recarregado"; fi
  if ldd "$P/sbin/php-fpm" 2>&1 | grep -q 'not found'; then restore; die "biblioteca ausente apos a troca; backup restaurado"; fi
  say "recarregando $UNIT"
  systemctl reload "$UNIT" || systemctl restart "$UNIT" || say "AVISO: falha ao recarregar $UNIT"
  sleep 3
  echo "unit: $(systemctl is-active "$UNIT")"
  "$P/sbin/php-fpm" -v 2>&1 | head -1
  M=$(pgrep -f "php-fpm: master process \($P/etc/php-fpm.conf\)" | head -1)
  [ -n "$M" ] && echo "master $M exe=$(readlink -f /proc/$M/exe)"
  if [ "$OLD_BROKEN" = 1 ]; then
    say "ATENCAO: o binario ANTIGO nao carrega (biblioteca ausente). NAO faca rollback: o reload derrubaria o php-fpm."
  else
    say "rollback manual: tar -xf $BK -C / && systemctl reload $UNIT"
  fi
  ;;
esac
PAYLOAD_EOF

case "$MODE" in
  build)
    log "ibr-php-rebuild v$VERSION | build php $PV em $HOST:$DIR (staging; producao NAO e alterada)"
    "${SSH[@]}" "sudo mkdir -p /opt/ibr-build && sudo tee /opt/ibr-build/payload.sh >/dev/null" <<<"$PAYLOAD" || die "nao consegui enviar o payload"
    "${SSH[@]}" "sudo -n env $ENVV IBR_MODE=build setsid nohup bash /opt/ibr-build/payload.sh >/dev/null 2>&1 </dev/null &" || die "nao consegui iniciar o build"
    log "build iniciado em segundo plano. Acompanhando (Ctrl-C nao interrompe o build; use 'status' depois)."
    sleep 10
    while :; do
      S=$("${SSH[@]}" "sudo cat /opt/ibr-build/$(basename "$DIR")-$PV/STATUS 2>/dev/null" 2>/dev/null)
      case "$S" in
        OK) log "BUILD OK. Revise: status; depois, na janela: swap"; exit 0 ;;
        FAIL*) log "BUILD FALHOU: $S"; "${SSH[@]}" "sudo tail -n 25 /opt/ibr-build/$(basename "$DIR")-$PV/build.log" 2>/dev/null; exit 1 ;;
        *) log "em andamento ..."; sleep 30 ;;
      esac
    done ;;
  status|swap)
    if [ "$MODE" = swap ] && [ "$YES" -ne 1 ]; then
      echo "Vai trocar os binarios de $DIR em $HOST por PHP $PV e RECARREGAR o php-fpm (graceful)."
      read -r -p "Digite SIM para continuar: " ans; [ "$ans" = "SIM" ] || die "cancelado"
    fi
    "${SSH[@]}" "sudo mkdir -p /opt/ibr-build && sudo tee /opt/ibr-build/payload.sh >/dev/null" <<<"$PAYLOAD" || die "nao consegui enviar o payload"
    "${SSH[@]}" "sudo -n env $ENVV IBR_MODE=$MODE bash /opt/ibr-build/payload.sh" ;;
esac
