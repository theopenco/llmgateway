#!/bin/bash
set -e

echo "Starting LLMGateway unified container..."

# Create node user if it doesn't exist
if ! id "node" &>/dev/null; then
    adduser -D -s /bin/sh node
fi

# Create log directories and files with proper permissions
mkdir -p /var/log/supervisor /var/log/nginx /var/log/postgresql
touch /var/log/nginx/access.log /var/log/nginx/error.log /var/log/postgresql.log
chown postgres:postgres /var/log/postgresql.log
chmod 644 /var/log/postgresql.log

# Initialize PostgreSQL if data directory is empty
if [ ! -s "/var/lib/postgresql/data/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."

    # Initialize database
    su postgres -c "initdb -D /var/lib/postgresql/data"

    # Start PostgreSQL temporarily for setup
    su postgres -c "pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql.log start"

    # Wait for PostgreSQL to start
    sleep 5

    # Create database and user
    su postgres -c "createdb $POSTGRES_DB" || true
    su postgres -c "psql -c \"ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';\"" || true

    # Run initialization scripts if they exist
    if [ -d "/docker-entrypoint-initdb.d" ]; then
        for f in /docker-entrypoint-initdb.d/*; do
            case "$f" in
                *.sql)    echo "Running $f"; su postgres -c "psql -d $POSTGRES_DB -f $f"; echo ;;
                *.sql.gz) echo "Running $f"; gunzip -c "$f" | su postgres -c "psql -d $POSTGRES_DB"; echo ;;
                *)        echo "Ignoring $f" ;;
            esac
        done
    fi

    # Stop PostgreSQL
    su postgres -c "pg_ctl -D /var/lib/postgresql/data stop"

    echo "PostgreSQL initialization complete."
else
    echo "PostgreSQL data directory already exists, skipping initialization."
fi

# Set proper ownership
chown -R postgres:postgres /var/lib/postgresql
chown -R redis:redis /var/lib/redis
chown -R node:node /app/services

# Create log directories
mkdir -p /var/log/supervisor /var/log/nginx
touch /var/log/nginx/access.log /var/log/nginx/error.log

# Wait a moment for filesystem operations to complete
sleep 2

echo "Starting all services with supervisord..."

# Start supervisord which will manage all processes
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
