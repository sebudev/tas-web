#!/bin/bash
# Wrapper — pattern sama untuk semua app
# Usage: ./deploy.sh [--skip-git] [--no-cache]
# Di server tinggal: ./deploy.sh  atau  deploy tas
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec /usr/local/bin/deploy tas "$@"
