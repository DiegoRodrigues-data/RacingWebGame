#!/bin/sh
# Restaura um backup: ./restore.sh /backups/tracado-AAAAMMDDTHHMMSSZ.sql.gz
# ATENÇÃO: apaga e recria o banco "tracado". Pare o serviço "api" antes.
set -eu
f="$1"
psql -d postgres -c 'DROP DATABASE IF EXISTS tracado;' -c 'CREATE DATABASE tracado;'
gunzip -c "$f" | psql -d tracado
echo "restaurado de $f"
