#!/bin/sh
set -eu
export NOVA_DB_PASSWORD="$(cat /run/secrets/app_db_password)"
export KEYCLOAK_DB_PASSWORD="$(cat /run/secrets/identity_db_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv nova_password NOVA_DB_PASSWORD
\getenv keycloak_password KEYCLOAK_DB_PASSWORD
CREATE ROLE nova LOGIN PASSWORD :'nova_password';
CREATE DATABASE nova OWNER nova;
CREATE ROLE nova_identity LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE nova_identity OWNER nova_identity;
SQL
