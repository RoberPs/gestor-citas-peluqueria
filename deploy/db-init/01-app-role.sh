#!/bin/sh
# First start of the cluster only (docker-entrypoint-initdb.d): the role the
# app connects as and the database it owns.
#
# The app is NOT a superuser. `btree_gist` is a trusted extension since
# PostgreSQL 13, so the database owner can create it, and the migrations need
# nothing more. A superuser connection would turn any SQL injection into
# commands run inside the database container.
#
# Changing APP_DB_PASSWORD later does nothing here: this runs once, when the
# volume is empty. To rotate it, ALTER ROLE salon_app by hand (deploy/README.md).
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is missing from db.env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE salon_app LOGIN PASSWORD :'app_password';
CREATE DATABASE salon OWNER salon_app;
REVOKE ALL ON DATABASE salon FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE salon TO salon_app;
SQL
