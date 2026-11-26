#!/bin/sh
set -eu
cd /opt/portfolioai
exec 9>/var/lock/portfolioai-backup.lock
flock -n 9 || exit 0
umask 077
mkdir -p /opt/portfolioai-backups /opt/portfolioai-backup-stage
compose() { docker compose -f deploy/compose.yml "$@"; }
# Quiesce writes so database, object storage and vector snapshots agree.
trap 'compose start chroma knowledge web worker >/dev/null' EXIT
compose stop web worker knowledge chroma >/dev/null
compose exec -T database pg_dump -U portfolio_admin -d portfolio -Fc > /opt/portfolioai-backup-stage/database.dump
tar -czf /opt/portfolioai-backup-stage/snapshot.tar.gz \
  -C /opt/portfolioai-backup-stage database.dump \
  -C /opt/portfolioai deploy/application.env deploy/database.env deploy/knowledge.env deploy/migration.env \
  -C /var/lib/docker/volumes portfolioai-cloud_chroma/_data portfolioai-cloud_knowledge/_data portfolioai-cloud_objects/_data
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -pass file:/root/portfolioai-backup-passphrase \
  -in /opt/portfolioai-backup-stage/snapshot.tar.gz \
  -out "/opt/portfolioai-backups/$(date -u +%Y%m%dT%H%M%SZ).tar.gz.enc"
rm -f /opt/portfolioai-backup-stage/database.dump /opt/portfolioai-backup-stage/snapshot.tar.gz
find /opt/portfolioai-backups -maxdepth 1 -name '*.tar.gz.enc' -mtime +7 -delete
echo 'Encrypted backup completed.'
compose start chroma knowledge web worker >/dev/null
trap - EXIT
python3 /opt/portfolioai/deploy/upload_backup.py
