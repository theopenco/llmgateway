#!/bin/bash
set -e

echo "Starting LLMGateway unified container..."

# Create node user if it doesn't exist
if ! id "node" &>/dev/null; then
    adduser --system --shell /bin/sh --no-create-home node
fi

# Create log directories and files
mkdir -p /var/log/supervisor /var/log/postgresql
touch /var/log/postgresql.log
chown postgres:postgres /var/log/postgresql.log
chmod 644 /var/log/postgresql.log

# Initialize PostgreSQL if data directory is empty
if [ ! -s "/var/lib/postgresql/data/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."
    
    # Ensure PostgreSQL data directory has correct ownership
    chown -R postgres:postgres /var/lib/postgresql
    chmod 700 /var/lib/postgresql/data

    # Initialize database
    su postgres -c "/usr/lib/postgresql/17/bin/initdb -D /var/lib/postgresql/data"

    echo "PostgreSQL cluster initialized successfully."
fi

# Always ensure the application database exists
echo "Checking if application database exists..."

# Start PostgreSQL temporarily for setup if not running
if ! su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data status" >/dev/null 2>&1; then
    echo "Starting PostgreSQL for database setup..."
    su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data -l /var/log/postgresql.log start"
    
    # Wait for PostgreSQL to start
    sleep 5
fi

# Check if database exists and create if needed
if ! su postgres -c "/usr/lib/postgresql/17/bin/psql -lqt" | cut -d \| -f 1 | grep -qw "$POSTGRES_DB"; then
    echo "Creating database $POSTGRES_DB..."
    su postgres -c "/usr/lib/postgresql/17/bin/createdb $POSTGRES_DB" || true
fi

# Set postgres password
echo "Setting postgres user password..."
su postgres -c "/usr/lib/postgresql/17/bin/psql -c \"ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';\"" || true

# Run initialization scripts if they exist
if [ -d "/docker-entrypoint-initdb.d" ]; then
    for f in /docker-entrypoint-initdb.d/*; do
        case "$f" in
            *.sql)    echo "Running $f"; su postgres -c "/usr/lib/postgresql/17/bin/psql -d $POSTGRES_DB -f $f"; echo ;;
            *.sql.gz) echo "Running $f"; gunzip -c "$f" | su postgres -c "/usr/lib/postgresql/17/bin/psql -d $POSTGRES_DB"; echo ;;
            *)        echo "Ignoring $f" ;;
        esac
    done
fi

# Stop PostgreSQL (it will be started by supervisord)
echo "Stopping temporary PostgreSQL instance..."
su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/data stop" || true

echo "PostgreSQL setup complete."

echo "About to skip ownership changes..."
# Skip ALL ownership changes for faster startup
echo "Skipping ownership changes for faster startup."

# Create log directories
echo "Creating log directories..."
mkdir -p /var/log/supervisor
echo "Log directories created."

# Wait a moment for filesystem operations to complete
echo "Sleeping for 2 seconds..."
sleep 2
echo "Sleep complete."

echo "Starting all services with supervisord..."

# Start supervisord which will manage all processes
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
