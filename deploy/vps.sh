#!/usr/bin/env bash
# Setting up on the shared VPS (deploy/README.md). Runs INSIDE the VPS, as
# `operador`, from /srv/gestor-citas/deploy. Three subcommands, all repeatable:
#
#   bash vps.sh preparar <dominio>           estructura, entornos 0600 y clave de copias
#   bash vps.sh imagen <versión> <digest>    baja la imagen de GHCR y comprueba su digest
#   bash vps.sh comprobar                    lo que no puede fallar, sin cambiar nada
#
# It never prints a secret. `preparar` never overwrites a file that exists, so
# running it again changes no password.
set -euo pipefail

BASE=/srv/gestor-citas
DEPLOY="$BASE/deploy"
BACKUPS="$BASE/niza/backups"
IMAGEN=ghcr.io/roberps/gestor-citas-peluqueria
DUENO=operador
COMPOSE=(sudo docker compose -f "$DEPLOY/docker-compose.prod.yml")

fallos=0
ok() { printf '  ok    %s\n' "$*"; }
mal() { printf '  MAL   %s\n' "$*"; fallos=$((fallos + 1)); }
info() { printf '\n== %s\n' "$*"; }

# Hex: no `$`, `@`, `:` or `/`, so it goes into a DATABASE_URL as it is.
secreto_hex() { openssl rand -hex 24; }

escribir_si_falta() {
  local fichero=$1
  if [[ -e "$fichero" ]]; then
    ok "$fichero ya existe: no se toca"
    cat >/dev/null
    return
  fi
  (umask 077 && cat >"$fichero")
  chmod 600 "$fichero"
  ok "$fichero creado (0600)"
}

preparar() {
  local dominio=${1:?uso: bash vps.sh preparar <dominio>, p. ej. niza.automatizacionro.work}

  info 'Estructura'
  sudo install -d -o "$DUENO" -g "$DUENO" -m 0750 "$BASE"
  sudo install -d -o "$DUENO" -g "$DUENO" -m 0700 "$BASE/niza" "$BACKUPS"
  chmod 755 "$DEPLOY/db-init"
  chmod 755 "$DEPLOY/db-init/"*.sh "$DEPLOY/backup.sh" "$DEPLOY/vps.sh"
  ok "$BASE, $BACKUPS (0700) y los scripts ejecutables"

  info 'Entornos'
  local app_db
  if [[ -e "$BASE/db.env" ]]; then
    app_db=$(sed -n 's/^APP_DB_PASSWORD=//p' "$BASE/db.env")
  else
    app_db=$(secreto_hex)
  fi

  escribir_si_falta "$BASE/db.env" <<EOF
POSTGRES_PASSWORD=$(secreto_hex)
APP_DB_PASSWORD=$app_db
EOF

  escribir_si_falta "$BASE/app.env" <<EOF
DATABASE_URL=postgresql://salon_app:$app_db@gestor-citas-db:5432/salon
SALON_TIMEZONE=Europe/Madrid
RATE_LIMIT_SECRET=$(secreto_hex)
TRUSTED_PROXY_IPS=caddy
PUBLIC_BASE_URL=https://$dominio
NOTIFICATIONS_EMAIL=off
NOTIFICATIONS_SMS=off
EMAIL_PROVIDER=brevo
EMAIL_API_KEY=
EMAIL_FROM=
EMAIL_REPLY_TO=
NOTIFICATION_SEAL_KEY=$(openssl rand -base64 32)
OWNER_USERNAME=
OWNER_INITIAL_PASSWORD=
EOF

  # The backup key: without it a .cbak is useless, to whoever steals it too.
  # It must also be in Bitwarden, or the copies on the PC protect nothing.
  escribir_si_falta "$BASE/backup.key" <<EOF
$(openssl rand -base64 48)
EOF

  info 'Red del chatbot'
  if sudo docker network inspect chatbot_proxy >/dev/null 2>&1; then
    ok 'chatbot_proxy existe'
  else
    mal 'no existe la red chatbot_proxy: mira `sudo docker network ls`'
  fi

  sin_crlf
  terminar
}

imagen() {
  local version=${1:?uso: bash vps.sh imagen <version> <digest>} digest=${2:?falta el digest, sha256:…}

  info "Imagen $IMAGEN:$version"
  sudo docker pull --quiet "$IMAGEN:$version" >/dev/null
  local bajado etiqueta
  bajado=$(sudo docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$IMAGEN:$version" |
    sed -n "s|^$IMAGEN@||p" | head -n1)
  etiqueta=$(sudo docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGEN:$version")

  if [[ "$bajado" == "$digest" ]]; then ok "digest $digest"; else mal "digest $bajado, se esperaba $digest"; fi
  if [[ "$etiqueta" == "$version" ]]; then ok "etiqueta OCI $etiqueta"; else mal "etiqueta OCI '$etiqueta', se esperaba $version"; fi

  if ((fallos == 0)); then
    # The .env NEXT TO the compose: `sudo` clears the environment, an export would be lost.
    printf 'GESTOR_IMAGEN=%s\nGESTOR_VERSION=%s\n' "$IMAGEN" "$version" >"$DEPLOY/.env"
    ok "$DEPLOY/.env apunta a $version"
  fi
  terminar
}

sin_crlf() {
  info 'Saltos de línea'
  local fichero
  for fichero in "$BASE"/*.env "$BASE/backup.key" "$DEPLOY"/*.sh "$DEPLOY"/db-init/*.sh "$DEPLOY"/docker-compose.prod.yml; do
    [[ -e "$fichero" ]] || continue
    if [[ $(tr -cd '\r' <"$fichero" | wc -c) -eq 0 ]]; then ok "$fichero sin CRLF"; else mal "$fichero tiene CRLF: sed -i 's/\\r\$//' $fichero"; fi
  done
}

permisos() {
  info 'Permisos de los secretos'
  local fichero modo
  for fichero in "$BASE/db.env" "$BASE/app.env" "$BASE/backup.key"; do
    modo=$(stat -c '%U %a' "$fichero" 2>/dev/null || echo 'falta')
    if [[ "$modo" == "$DUENO 600" ]]; then ok "$fichero $modo"; else mal "$fichero: $modo (se espera $DUENO 600)"; fi
  done
  modo=$(stat -c '%U %a' "$BACKUPS" 2>/dev/null || echo 'falta')
  if [[ "$modo" == "$DUENO 700" ]]; then ok "$BACKUPS $modo"; else mal "$BACKUPS: $modo (se espera $DUENO 700)"; fi
  if grep -q '^OWNER_INITIAL_PASSWORD=.\+' "$BASE/app.env"; then
    mal 'OWNER_INITIAL_PASSWORD sigue en app.env: bórrala y recrea la app'
  else
    ok 'OWNER_INITIAL_PASSWORD vacía'
  fi
}

contenedores() {
  info 'Contenedores'
  local app=gestor-citas-app db=gestor-citas-db valor

  valor=$(sudo docker inspect --format '{{.State.Health.Status}}' "$app" 2>/dev/null || echo 'no existe')
  if [[ "$valor" == healthy ]]; then ok "$app healthy"; else mal "$app: $valor"; fi
  valor=$(sudo docker inspect --format '{{.State.Health.Status}}' "$db" 2>/dev/null || echo 'no existe')
  if [[ "$valor" == healthy ]]; then ok "$db healthy"; else mal "$db: $valor"; fi

  [[ $(sudo docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$app") == true ]] && ok 'app: raíz de sólo lectura' || mal 'app: la raíz se puede escribir'
  [[ $(sudo docker inspect --format '{{.HostConfig.CapDrop}}' "$app") == '[ALL]' ]] && ok 'app: sin capacidades' || mal 'app: conserva capacidades'
  [[ $(sudo docker inspect --format '{{.HostConfig.SecurityOpt}}' "$app") == *no-new-privileges:true* ]] && ok 'app: no-new-privileges' || mal 'app: sin no-new-privileges'
  [[ $(sudo docker exec "$app" id -u) == 1000 ]] && ok 'app: corre como node (1000)' || mal 'app: no corre como UID 1000'

  for valor in "$app" "$db"; do
    if [[ -z $(sudo docker port "$valor") ]]; then ok "$valor no publica puertos"; else mal "$valor publica: $(sudo docker port "$valor" | tr '\n' ' ')"; fi
  done

  valor=$(sudo docker inspect --format '{{range $red, $_ := .NetworkSettings.Networks}}{{$red}} {{end}}' "$db")
  [[ "$valor" == 'gestor-citas_interno ' ]] && ok 'db sólo en la red interna' || mal "db en: $valor"
  valor=$(sudo docker inspect --format '{{range $red, $_ := .NetworkSettings.Networks}}{{$red}} {{end}}' "$app")
  [[ "$valor" == *chatbot_proxy* && "$valor" == *gestor-citas_interno* ]] && ok 'app en chatbot_proxy y en la interna' || mal "app en: $valor"
}

base_de_datos() {
  info 'PostgreSQL'
  local consulta
  consulta=$("${COMPOSE[@]}" exec -T db sh -c 'grep -Ev "^\s*(#|$)" "$PGDATA/pg_hba.conf" | grep -cw trust || true')
  [[ "$consulta" == 0 ]] && ok 'pg_hba.conf sin reglas trust' || mal "pg_hba.conf tiene $consulta regla(s) trust"
  consulta=$("${COMPOSE[@]}" exec -T db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -tA -c "select rolsuper::text from pg_roles where rolname = '"'"'salon_app'"'"'"')
  [[ "$consulta" == false ]] && ok 'salon_app no es superusuario' || mal "salon_app: rolsuper=$consulta"
  consulta=$("${COMPOSE[@]}" exec -T db sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d salon -tA -c "select count(*) from pg_extension where extname = '"'"'btree_gist'"'"'"')
  [[ "$consulta" == 1 ]] && ok 'btree_gist instalada' || mal 'btree_gist no está: falta node cli/migrate.mjs'
}

red() {
  info 'Escucha del anfitrión'
  if sudo ss -ltnH | awk '{print $4}' | grep -Eq ':(3000|5432)$'; then
    mal 'algo escucha en 3000 o 5432 en el anfitrión'
  else
    ok 'nada en 3000 ni en 5432'
  fi
  local salud
  salud=$(sudo docker exec "$(sudo docker ps -qf name=caddy | head -n1)" wget -qO- http://gestor-citas-app:3000/health 2>/dev/null || true)
  [[ "$salud" == '{"status":"ok"}' ]] && ok 'Caddy llega a la app: /health ok' || mal "Caddy no llega a la app: '$salud'"
}

comprobar() {
  sin_crlf
  permisos
  contenedores
  base_de_datos
  red
  terminar
}

terminar() {
  echo
  if ((fallos == 0)); then echo 'TODO BIEN'; else echo "$fallos FALLO(S)"; exit 1; fi
}

case "${1:-}" in
  preparar) shift; preparar "$@" ;;
  imagen) shift; imagen "$@" ;;
  comprobar) comprobar ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
