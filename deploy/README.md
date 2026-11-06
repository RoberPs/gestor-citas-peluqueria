# Despliegue en el VPS compartido

Producción de prueba en `niza.automatizacionro.work`, en el VPS y el Cloudflare del
chatbot multicliente (roadmap, paso 7b y decisiones del 2026-11-04). Esta guía es el
paso a paso; el porqué de cada pieza está en los comentarios de cada fichero.

```
Visitante ─▶ Cloudflare (Full strict) ─▶ 443 del VPS ─▶ Caddy del chatbot
                                                        │ red chatbot_proxy
                                                        ▼
                                        gestor-citas-app:3000 ──▶ Brevo (API HTTP)
                                                        │ red interna (sin salida)
                                                        ▼
                                        gestor-citas-db (PostgreSQL 16, sin puertos)
```

## Qué hay aquí

| Fichero | En el VPS | Qué es |
|---|---|---|
| `docker-compose.prod.yml` | `/srv/gestor-citas/deploy/` | La app y su PostgreSQL. Ninguno publica puertos |
| `db-init/01-app-role.sh` | igual | Primer arranque de la base: rol `salon_app`, **no superusuario**, dueño de `salon` |
| `vps.sh` | igual | `preparar`, `imagen` y `comprobar`. Repetible y sin imprimir secretos |
| `backup.sh` | igual | Copia diaria cifrada y verificada |
| `cron.d/gestor-citas` | `/etc/cron.d/gestor-citas` | Reintentos de email, cada minuto |
| `systemd/gestor-citas-*` | `/etc/systemd/system/` | Copia (03:15) y purga (03:30), en hora de Madrid |
| `caddy/gestor-citas.caddy` | se pega en `/srv/chatbot/deploy/Caddyfile` | El bloque de este proyecto en el Caddy del chatbot |
| `salon.example.json` | `/srv/gestor-citas/salon.json` | Datos del salón para `load-salon` (hoy, los de la demo) |
| `prueba-ip.sh` | — (se lanza en el PC) | La app ve la IP real de cada visitante |

Fuera del repositorio, en `/srv/gestor-citas/`, dueño `operador` y modo `0600`:
`app.env`, `db.env` y `backup.key`. Las copias, en `/srv/gestor-citas/niza/backups/`
(`0700`).

## Reglas que costaron caras en el chatbot

- **Terminal del PC: Git Bash.** La clave es `~/.ssh/chatbot_vps` (o el alias `vps`).
  Si una orden empieza por `ssh` o `scp`, va en el PC; si no, dentro del VPS.
- **Todas las órdenes de Docker van con `sudo`**, que limpia el entorno: la versión de
  la imagen va en `/srv/gestor-citas/deploy/.env` (lo escribe `vps.sh imagen`), nunca
  en un `export`.
- **Cambiar un `env_file` exige recrear el contenedor.** En la salida de `up -d` tiene
  que poner `Recreated`; `Running` es que Compose no vio el cambio.
- Los entornos van **sin comillas** (`format: raw`) y **sin CRLF**:
  `tr -cd '\r' < fichero | wc -c` tiene que dar `0`. Edita con `nano -w`.
- Un timeout de SSH suele ser el cortafuegos de Hetzner (IP dinámica fuera de
  `83.36.0.0/14` y `83.56.0.0/14`), no `fail2ban`.
- Un secreto nunca se pega en el chat ni dentro del texto de un `read -p`.

La forma corta de las órdenes de abajo:

```bash
# en el VPS
C="sudo docker compose -f /srv/gestor-citas/deploy/docker-compose.prod.yml"
```

## 1 · Imagen (en el PC)

Se construye en el PC (x86, como el VPS), se publica en GHCR privado y se despliega
comprobando el digest. Nunca `latest`.

```bash
cd /c/Rober/Roberto/ai/claude/spec_driven_development/proyectoro/gestor-citas-peluqueria
VERSION=$(node -p "require('./package.json').version")
docker build --build-arg APP_VERSION=$VERSION -t ghcr.io/roberps/gestor-citas-peluqueria:$VERSION .
docker login ghcr.io -u roberps        # pide el token con write:packages, sin mostrarlo
docker push ghcr.io/roberps/gestor-citas-peluqueria:$VERSION
docker buildx imagetools inspect ghcr.io/roberps/gestor-citas-peluqueria:$VERSION | grep '^Digest'
```

Anota el digest (`sha256:…`): es lo que se comprueba en el VPS. Después, en GitHub →
*Packages*, confirma que `gestor-citas-peluqueria` figura como **privado**.

La construcción falla si `APP_VERSION` no es la de `package.json`. Una versión
publicada no se vuelve a publicar: para cambiar algo, se sube `version`.

## 2 · Cloudflare, Brevo y el VPS (cuentas)

- **Cloudflare**: registro `A` `niza` → `91.99.107.86`, **con proxy** (nube naranja),
  sin `AAAA`. Comprueba que resuelve a direcciones de Cloudflare, no a la del VPS.
  En *Scrape Shield*, «Email Address Obfuscation» **apagado**; en *Speed*, «Rocket
  Loader» **apagado**: la CSP bloquearía lo que inyectan. «Always Use HTTPS» sigue
  apagado (rompe el HTTP-01).
- **Brevo**: una **clave de API** (`xkeysib-…`, no SMTP) sólo para este proyecto. Si
  está activo el bloqueo por IP de las claves de API, añade la IPv4 del VPS.
- **VPS**: `sudo docker network ls` tiene que mostrar `chatbot_proxy`.

## 3 · Ficheros y entornos (VPS)

En el PC. El `rm` va primero porque, si la carpeta ya existe, `scp -r` no la sustituye:
mete la nueva dentro, como `~/gestor-citas-deploy/deploy/` (pasó el 2026-11-05):

```bash
ssh vps 'rm -rf ~/gestor-citas-deploy'; scp -r deploy vps:~/gestor-citas-deploy
```

En el VPS:

```bash
sudo install -d -o operador -g operador -m 0750 /srv/gestor-citas
cp -rT ~/gestor-citas-deploy /srv/gestor-citas/deploy
cp /srv/gestor-citas/deploy/salon.example.json /srv/gestor-citas/salon.json
cd /srv/gestor-citas/deploy && bash vps.sh preparar niza.automatizacionro.work
```

`preparar` crea `db.env`, `app.env` y `backup.key` con secretos aleatorios (hex o
base64, sin `$`), en `0600`, y no toca los que ya existan. El email queda apagado
(`NOTIFICATIONS_EMAIL=off`) hasta el paso 9.

**A Bitwarden, ahora**: `backup.key` entera (sin ella las copias del PC no sirven de
nada; es lo que destapó la fase 10 del chatbot) y las dos contraseñas de `db.env`.
Léelas con `cat` en la terminal del VPS y cópialas de ahí.

## 4 · Base de datos y app

```bash
cd /srv/gestor-citas/deploy
bash vps.sh imagen 1.0.0 sha256:<digest del paso 1>
$C up -d db
$C logs db | grep -E 'CREATE ROLE|CREATE DATABASE|ready to accept'
$C run --rm --no-deps app node cli/migrate.mjs     # Applied 8 migration(s): …
$C up -d app
$C ps                                             # las dos healthy
```

Si `docker pull` responde `denied`, el VPS no tiene sesión en GHCR:
`sudo docker login ghcr.io -u roberps` con un token de sólo `read:packages`.

`btree_gist` la crea la migración con `salon_app`: es una extensión «de confianza»
desde PostgreSQL 13, así que basta ser el dueño de la base. Comprobado en local el
2026-11-05.

## 5 · Datos del salón

```bash
$C exec -T app node cli/seed-demo.mjs
```

Carga la Peluquería de Caballeros Niza de `db/seed/demo.ts`. **`db:seed` no se ejecuta
en producción** y la imagen no lo trae: es el fixture de los tests («Peluquería
Aurora», con sus cuatro servicios y un festivo), y lo único que dejaría en esta base
son servicios desactivados para siempre. `seed-demo` borra los periodos no
disponibles, así que **sólo sirve para el primer arranque**.

Desde ahí, y mientras falte la US7–US9, los cambios de horario, servicios, festivos
y parámetros de reserva se hacen editando `/srv/gestor-citas/salon.json` y:

```bash
$C exec -T app node cli/load-salon.mjs - --dry-run < /srv/gestor-citas/salon.json   # sólo comprueba
$C exec -T app node cli/load-salon.mjs - < /srv/gestor-citas/salon.json
```

`load-salon` **conserva los ratos que la dueña bloquee** desde la agenda; añade o
actualiza los festivos por fecha (uno sobrante se libera desde la agenda). Un
servicio que sale del fichero se desactiva, no se borra. El `id` de cada servicio no
se cambia nunca; uno nuevo lleva un `id` nuevo (`cat /proc/sys/kernel/random/uuid`).
Un precio es `null` («Precio a consultar en el salón») o un número de céntimos mayor
que 0.

## 6 · Cuenta de la dueña

Sin abrir ningún editor: el 2026-11-05 se pegaron órdenes dentro de `app.env` con `nano` y
el fichero dejó de leerse. Una línea cada vez, en la terminal:

```bash
sed -i "s/^OWNER_USERNAME=.*/OWNER_USERNAME=<usuario>/" /srv/gestor-citas/app.env
NUEVA=$(openssl rand -hex 12)     # 24 caracteres, sin nada que se rompa al pegar
sed -i "s/^OWNER_INITIAL_PASSWORD=.*/OWNER_INITIAL_PASSWORD=$NUEVA/" /srv/gestor-citas/app.env
echo "$NUEVA"                     # a Bitwarden, con el usuario
$C up -d app                     # Recreated
$C exec -T app node cli/provision-owner.mjs
sed -i "s/^OWNER_INITIAL_PASSWORD=.*/OWNER_INITIAL_PASSWORD=/" /srv/gestor-citas/app.env
$C up -d app                     # Recreated otra vez
unset NUEVA; clear
```

Si `app.env` se rompe (`failed to parse env_file`), `awk '{i=index($0,"="); print substr($0,1,i-1), length(substr($0,i+1))}' app.env`
enseña cada variable con la longitud de su valor, sin el valor.

La app nunca lee esas dos variables; la contraseña sólo tiene que vivir unos minutos
en el entorno del contenedor. `vps.sh comprobar` falla si sigue ahí. Lo mismo, si un
día la olvida: no hay recuperación en la app (FR-005).

## 7 · Caddy del chatbot

**Toca el Caddy del chatbot, que da servicio a sus tres instancias. Revísalo antes.**

1. Añadir a `/srv/chatbot/caddy.env`: `GESTOR_CITAS_DOMINIO=niza.automatizacionro.work`
2. Pegar al final de `/srv/chatbot/deploy/Caddyfile` el bloque de
   `caddy/gestor-citas.caddy` (y, después, el mismo cambio en el repositorio del
   chatbot, para que no se pierda en la próxima subida).
3. Validar **antes** de recrear, con un contenedor de un solo uso que lee el mismo
   entorno y el mismo fichero (no publica puertos):

   ```bash
   CH="sudo docker compose -f /srv/chatbot/deploy/docker-compose.prod.yml"
   $CH run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile
   ```

4. `$CH up -d caddy` → `Recreated` (un corte de segundos para el chatbot), y
   `$CH logs -f caddy` hasta ver `certificate obtained successfully` para `niza`.

Si el desafío falla con 526 (lo que pasó con la zona en modo automático), una
*Configuration Rule* de Cloudflare para `niza.automatizacionro.work` con SSL «Full»
mientras sale el certificado, y se quita después. No hace falta tocar el modo de la
zona.

## 8 · Comprobaciones

```bash
cd /srv/gestor-citas/deploy && bash vps.sh comprobar     # TODO BIEN
```

Comprueba entornos `0600` sin CRLF, contraseña inicial retirada, contenedores
`healthy`, raíz de sólo lectura, sin capacidades, `no-new-privileges`, UID 1000,
ningún puerto publicado, la base sólo en la red interna, `pg_hba.conf` sin `trust`,
`salon_app` sin superusuario, `btree_gist`, nada escuchando en 3000 o 5432 y que Caddy
llega a `/health`.

**La IP del cliente detrás de Cloudflare**, en el PC:

```bash
bash deploy/prueba-ip.sh https://niza.automatizacionro.work
```

Cinco `400` y un `429` aunque cada petición falsee `X-Forwarded-For`; luego, con el PC
en el punto de acceso del móvil (datos, otra IP), la orden que imprime tiene que dar
`400`. Deja la IP de casa sin reservas online una hora: `$C restart app` vacía los
contadores.

## 9 · Email de confirmación

En `/srv/gestor-citas/app.env`:

```
NOTIFICATIONS_EMAIL=on
EMAIL_API_KEY=xkeysib-…
EMAIL_FROM=<dirección del dominio verificado en Brevo>
EMAIL_REPLY_TO=<email del salón>
```

Sin editor, como en el paso 6. La clave la lee `read -rs`, que no la enseña ni la deja
en el historial; pégala y pulsa Intro aunque no se vea nada:

```bash
cd /srv/gestor-citas
read -rs CLAVE
echo ${#CLAVE}                    # 89
sed -i "s/^EMAIL_API_KEY=.*/EMAIL_API_KEY=$CLAVE/" app.env
unset CLAVE
grep -c '^EMAIL_API_KEY=xkeysib-[A-Za-z0-9-]*$' app.env   # 1
sed -i "s/^EMAIL_FROM=.*/EMAIL_FROM=<remitente>/" app.env
sed -i "s/^EMAIL_REPLY_TO=.*/EMAIL_REPLY_TO=<respuestas>/" app.env
sed -i "s/^NOTIFICATIONS_EMAIL=.*/NOTIFICATIONS_EMAIL=on/" app.env
```

Si el `grep` da `0`, mira el prefijo con
`sed -n 's/^EMAIL_API_KEY=//p' app.env | head -c 4 | od -c`: `x s m t` es la clave **SMTP**
(`xsmtpsib-`), que Brevo enseña en la misma pantalla y con la que la API responde 401
(pasó el 2026-11-05). La de API está en *SMTP y API → Claves de API*.

`$C up -d app` → `Recreated`. Con el canal encendido, la app no arranca si falta la
clave, el remitente o `NOTIFICATION_SEAL_KEY`; el registro nombra la variable, no el
valor (`$C logs app`).

Después, **una reserva real con tu email**, marcando la casilla: llega un único email,
el enlace abre la cita, `/baja/…` pide confirmar. Mira en el original del mensaje qué
cabecera `List-Unsubscribe` llega (D-004 revisada). Cancela la cita al terminar. En la
base, sin datos personales:

```bash
$C exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d salon -c "select status, attempts, created_at from notification order by created_at desc limit 3"'
```

Tiene que salir `SENT` con `attempts` 1. Hecho el 2026-11-05 con Brevo: SPF, DKIM y DMARC en
`PASS`, y Brevo añade su `List-Unsubscribe` firmada.

## 10 · Tareas programadas

Dos mecanismos, porque **el cron de Ubuntu no entiende `CRON_TZ`** (comprobado en el
VPS el 2026-11-05: `grep -ac CRON_TZ /usr/sbin/cron` da `0`) y la copia y la purga
tienen que ir en hora de Madrid sin cambiar la zona del servidor, que es la del
chatbot:

| Qué | Cuándo | Dónde |
|---|---|---|
| Reintentos de los emails (004, D-003) | Cada minuto | `cron.d/gestor-citas` → `/etc/cron.d/` |
| Copia cifrada (`backup.sh`) | 03:15 hora de Madrid | `systemd/gestor-citas-backup.{service,timer}` |
| Purga por retención (D-012) | 03:30 hora de Madrid | `systemd/gestor-citas-purge.{service,timer}` |

```bash
sudo install -o root -g root -m 0644 /srv/gestor-citas/deploy/cron.d/gestor-citas /etc/cron.d/gestor-citas
sudo install -o root -g root -m 0644 /srv/gestor-citas/deploy/systemd/gestor-citas-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gestor-citas-backup.timer gestor-citas-purge.timer
systemctl list-timers 'gestor-citas-*'      # NEXT: 02:15 y 02:30 UTC en invierno
sudo /srv/gestor-citas/deploy/backup.sh     # la primera copia, a mano
sudo systemctl start gestor-citas-purge.service
sudo journalctl -t gestor-citas-dispatch -t gestor-citas-purge -t gestor-citas-backup -n 10 --no-pager
```

`list-timers` muestra la hora en UTC: 02:15 y 02:30 en invierno, 01:15 y 01:30 en
verano, que son siempre las 03:15 y 03:30 de Madrid. `Persistent=true` lanza al
volver la copia o la purga que se perdiera con el servidor apagado. El diario sólo se
lee con `sudo`: `operador` no está en el grupo `adm`.

## 11 · Copias fuera del VPS

`backup.sh` deja cada noche `gestor-citas__<UTC>__daily.cbak` en
`/srv/gestor-citas/niza/backups/`: `pg_dump` cifrado con gpg (AES-256, con control de
integridad), verificado con `pg_restore --list` antes de darlo por bueno, dueño
`operador`, `0600`. Guarda 14 días.

Lo baja el mismo script del chatbot, con otros parámetros, en PowerShell:

```powershell
& 'C:\Rober\Roberto\ai\claude\spec_driven_development\proyectoro\chatbotasesor_multicliente\deploy\descargar-copias.ps1' `
  -RutaRemota /srv/gestor-citas -Instancias niza -Destino C:\multiagente-backups\gestor-citas
```

Con su propio `-Destino`, para que su `estado.json` no pise el del chatbot. Para que
sea diario, una tarea del Programador de tareas, «Gestor citas - descargar copias del
VPS», con esa misma orden. En el disco USB van a `multiagente-backups\niza`.

**Restaurar** (probado en local el 2026-11-05: salón, 4 servicios, la cuenta de la
dueña, 8 migraciones y las 2 restricciones `EXCLUDE`):

```bash
D="$C exec -T db sh -c"
$D 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U postgres -O salon_app salon_restaurada'
gpg --batch --pinentry-mode loopback --passphrase-file /srv/gestor-citas/backup.key \
    --decrypt <copia>.cbak |
  $D 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U postgres --no-owner --role=salon_app -d salon_restaurada'
```

Para volver a ella, `DATABASE_URL` apunta a `salon_restaurada` y `$C up -d app`; para
probar sólo, se mira y se borra con `dropdb`.

## Actualizar a una versión nueva

1. Sube `version` en `package.json`, y en el PC el paso 1.
2. Copia `deploy/` si cambió (paso 3, sin `preparar`).
3. En el VPS: `bash vps.sh imagen <versión> <digest>`, `$C run --rm --no-deps app node cli/migrate.mjs`
   y `$C up -d app` → `Recreated`. `bash vps.sh comprobar`.

## Otras órdenes

| Para | Orden |
|---|---|
| Borrar los datos de un cliente que lo pide | `$C exec -T app node cli/retention-purge.mjs --appointment <uuid>` y el paso 2 de «Borrado de datos a petición» de `specs/004-notifications/quickstart.md` |
| Ver qué anonimizaría la purga | `$C exec -T app node cli/retention-purge.mjs --dry-run` |
| Rotar la contraseña de `salon_app` | `ALTER ROLE salon_app PASSWORD '…'` como `postgres`, y la misma en `APP_DB_PASSWORD` y `DATABASE_URL`; `$C up -d app` |
| Registros de la app | `$C logs --tail 100 app` (sin datos personales: Pino los redacta) |

## Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `GESTOR_VERSION` sin definir al lanzar el compose | Falta `/srv/gestor-citas/deploy/.env`: `vps.sh imagen` |
| `WARN … variable is not set` | Un `$` en un entorno sin `format: raw`: el aviso enseña trozos del secreto |
| La app en `Restarting` | El entorno no valida: `$C logs app` nombra la variable |
| Un cambio del entorno no se nota | El `up -d` dijo `Running`: no se recreó |
| 521 / 522 / 526 de Cloudflare | Nada escucha / el cortafuegos descarta / el origen aún no tiene certificado |
| 502 en `niza` | Caddy no encuentra `gestor-citas-app`: la app no está en `chatbot_proxy` o está parada |
| `429` al reservar desde casa | La `prueba-ip.sh` de hace menos de una hora: `$C restart app` |
