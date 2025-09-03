#!/bin/bash
set -e

echo "Starting LLMGateway unified container..."

# Create node user if it doesn't exist
if ! id "node" &>/dev/null; then
    adduser --system --shell /bin/sh --no-create-home node
fi

# Log directories already created at build time

# Initialize PostgreSQL if data directory is empty
if [ ! -s "/var/lib/postgresql/data/PG_VERSION" ]; then
    echo "Initializing PostgreSQL database..."
    # Initialize database with trust authentication for local connections
    echo "Running initdb command..."
    su postgres -c "/usr/lib/postgresql/17/bin/initdb -D /var/lib/postgresql/data --auth-local=trust --auth-host=trust" || {
        echo "ERROR: initdb failed"
        exit 1
    }
    echo "PostgreSQL cluster initialized successfully."
else
    echo "PostgreSQL already initialized (PG_VERSION exists)"
fi

# Always ensure the application database exists
echo "Checking if application database exists..."

# Start PostgreSQL temporarily for setup if not running
PGDATA_DIR="/var/lib/postgresql/data"
echo "Checking if PostgreSQL is already running..."

# More reliable check: use pg_isready instead of just PID file
if ! su postgres -c "/usr/lib/postgresql/17/bin/pg_isready -h /var/run/postgresql -U postgres" >/dev/null 2>&1; then
    echo "PostgreSQL not running, starting it..."
    
    # Clean up any stale PID files
    echo "Cleaning up stale PID files..."
    rm -f "$PGDATA_DIR/postmaster.pid"
    
    echo "Starting PostgreSQL with pg_ctl..."
    su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D $PGDATA_DIR -l /var/log/postgresql.log -o '-k /var/run/postgresql -p 5432' start" || {
        echo "ERROR: pg_ctl start failed"
        echo "PostgreSQL log content:"
        cat /var/log/postgresql.log 2>/dev/null || echo "No log file found"
        exit 1
    }
    
    # Wait for PostgreSQL to start with longer timeout
    timeout=60
    echo "Waiting for PostgreSQL to become ready..."
    while [ $timeout -gt 0 ]; do
        if su postgres -c "/usr/lib/postgresql/17/bin/pg_isready -h /var/run/postgresql -U postgres" >/dev/null 2>&1; then
            echo "PostgreSQL is ready!"
            break
        fi
        echo "Waiting for PostgreSQL to start... ($timeout seconds remaining)"
        sleep 2
        timeout=$((timeout - 2))
    done
    
    if [ $timeout -le 0 ]; then
        echo "ERROR: PostgreSQL failed to start within 60 seconds"
        echo "Checking PostgreSQL log:"
        cat /var/log/postgresql.log 2>/dev/null || echo "No log file found"
        echo "Checking PostgreSQL status:"
        su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D $PGDATA_DIR status" || echo "Status check failed"
        exit 1
    fi
else
    echo "PostgreSQL is already running"
fi

# Check if database exists and create if needed
if ! su postgres -c "/usr/lib/postgresql/17/bin/psql -h /var/run/postgresql -U postgres -lqt" | cut -d \| -f 1 | grep -qw "$POSTGRES_DB"; then
    echo "Creating database $POSTGRES_DB..."
    su postgres -c "/usr/lib/postgresql/17/bin/createdb -h /var/run/postgresql -U postgres $POSTGRES_DB" || true
fi

# Set postgres password
echo "Setting postgres user password..."
su postgres -c "/usr/lib/postgresql/17/bin/psql -h /var/run/postgresql -U postgres -c \"ALTER USER postgres PASSWORD '$POSTGRES_PASSWORD';\"" || true

# Run initialization scripts if they exist
if [ -d "/docker-entrypoint-initdb.d" ]; then
    for f in /docker-entrypoint-initdb.d/*; do
        case "$f" in
            *.sql)    echo "Running $f"; su postgres -c "/usr/lib/postgresql/17/bin/psql -h /var/run/postgresql -U postgres -d $POSTGRES_DB -f $f"; echo ;;
            *.sql.gz) echo "Running $f"; gunzip -c "$f" | su postgres -c "/usr/lib/postgresql/17/bin/psql -h /var/run/postgresql -U postgres -d $POSTGRES_DB"; echo ;;
            *)        echo "Ignoring $f" ;;
        esac
    done
fi

# Stop PostgreSQL (it will be started by supervisord)
echo "Stopping temporary PostgreSQL instance..."
su postgres -c "/usr/lib/postgresql/17/bin/pg_ctl -D $PGDATA_DIR stop -m fast" || true
# Wait for it to stop
sleep 2

echo "PostgreSQL setup complete."

echo "Starting all services with supervisord..."

# Start supervisord which will manage all processes
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
