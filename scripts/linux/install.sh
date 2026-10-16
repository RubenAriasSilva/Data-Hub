#!/usr/bin/env bash
# Instalación en Linux (Debian/Ubuntu): MySQL como servicio systemd + Data Hub con PM2.
# Uso:  bash scripts/linux/install.sh            # instala MySQL (si falta) y despliega
#       bash scripts/linux/install.sh --skip-mysql   # solo despliega (MySQL ya configurado en backend/.env)
# Es idempotente: vuelve a ejecutarlo tras cada "git pull" para actualizar.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env"
SKIP_MYSQL=0
[[ "${1:-}" == "--skip-mysql" ]] && SKIP_MYSQL=1

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
set_env() { # set_env CLAVE valor
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

cd "$REPO_ROOT"

step 'Verificando Node.js'
if ! command -v node >/dev/null; then
  echo 'Node.js no está instalado. Instálalo (20 o superior), por ejemplo:'
  echo '  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs'
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || { echo "Se requiere Node.js 20+ (tienes $(node --version))."; exit 1; }
echo "Node $(node --version)"

[[ -f "$ENV_FILE" ]] || cp "$REPO_ROOT/backend/.env.example" "$ENV_FILE"

if (( ! SKIP_MYSQL )); then
  if ! command -v mysqld >/dev/null && ! systemctl list-unit-files | grep -q '^mysql\.service'; then
    step 'Instalando MySQL Server'
    sudo apt-get update -y
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server
  fi
  step 'Habilitando MySQL al arranque'
  sudo systemctl enable --now mysql

  if [[ -z "$(get_env DB_PASSWORD)" || "$(get_env DB_USER)" == "root" ]]; then
    step 'Creando base de datos y usuario de la app'
    APP_PASS="$(tr -dc 'A-HJ-NP-Za-km-z2-9' </dev/urandom | head -c 20)"
    DB_NAME="$(get_env DB_NAME)"; DB_NAME="${DB_NAME:-data_hub}"
    sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'datahub'@'localhost' IDENTIFIED BY '$APP_PASS';
CREATE USER IF NOT EXISTS 'datahub'@'127.0.0.1' IDENTIFIED BY '$APP_PASS';
ALTER USER 'datahub'@'localhost' IDENTIFIED BY '$APP_PASS';
ALTER USER 'datahub'@'127.0.0.1' IDENTIFIED BY '$APP_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO 'datahub'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO 'datahub'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
    set_env DB_HOST 127.0.0.1
    set_env DB_PORT 3306
    set_env DB_USER datahub
    set_env DB_PASSWORD "$APP_PASS"
    set_env DB_NAME "$DB_NAME"
    echo 'Credenciales guardadas en backend/.env'
  fi
fi

step 'Instalando dependencias'
npm ci --prefix backend --omit=dev --no-audit --no-fund
npm ci --prefix frontend --no-audit --no-fund

step 'Compilando el frontend'
npm run build --prefix frontend

if ! command -v pm2 >/dev/null; then
  step 'Instalando PM2'
  if [[ -w "$(npm prefix -g)/lib" ]]; then npm install -g pm2; else sudo npm install -g pm2; fi
fi

step 'Iniciando / recargando con PM2'
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

step 'Registrando PM2 en systemd (arranque automático)'
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null
pm2 save

PORT="$(get_env PORT)"; PORT="${PORT:-4000}"
step 'Verificando'
for _ in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" || true)"
  [[ "$code" == "200" || "$code" == "503" ]] && break
  sleep 1
done
pm2 status
if [[ "${code:-}" == "200" ]]; then
  printf '\n\033[32mData Hub en ejecución.\033[0m\n'
elif [[ "${code:-}" == "503" ]]; then
  printf "\n\033[33mLa app corre pero NO conecta a MySQL. Revisa backend/.env y 'pm2 logs data-hub'.\033[0m\n"
else
  echo "La app no respondió en el puerto $PORT. Revisa: pm2 logs data-hub"; exit 1
fi
echo "  Local: http://localhost:$PORT"
for ip in $(hostname -I 2>/dev/null); do echo "  Red:   http://$ip:$PORT"; done
echo "Si usas firewall:  sudo ufw allow $PORT/tcp"
