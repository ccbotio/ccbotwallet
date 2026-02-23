#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"

# Default values
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  up        Start all services"
    echo "  down      Stop all services"
    echo "  restart   Restart all services"
    echo "  logs      View logs"
    echo "  status    Show service status"
    echo "  build     Build images"
    echo "  migrate   Run database migrations"
    echo "  ssl       Setup SSL certificates"
    echo ""
    echo "Options:"
    echo "  -e, --env FILE    Environment file (default: .env.production)"
    echo "  -h, --help        Show this help"
}

check_env() {
    if [[ ! -f "$DOCKER_DIR/$ENV_FILE" ]]; then
        log_error "Environment file not found: $DOCKER_DIR/$ENV_FILE"
        log_info "Copy .env.production.example to .env.production and configure it"
        exit 1
    fi
}

cmd_up() {
    log_info "Starting services..."
    cd "$DOCKER_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d
    log_info "Services started. Checking health..."
    sleep 5
    cmd_status
}

cmd_down() {
    log_info "Stopping services..."
    cd "$DOCKER_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down
    log_info "Services stopped"
}

cmd_restart() {
    log_info "Restarting services..."
    cmd_down
    cmd_up
}

cmd_logs() {
    cd "$DOCKER_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs -f "${@:-}"
}

cmd_status() {
    cd "$DOCKER_DIR"
    echo ""
    echo "=== Service Status ==="
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    echo ""
    echo "=== Health Checks ==="
    for service in ccbot-api ccbot-postgres ccbot-redis ccbot-nginx; do
        status=$(docker inspect --format='{{.State.Health.Status}}' "$service" 2>/dev/null || echo "not running")
        case "$status" in
            "healthy") echo -e "  $service: ${GREEN}healthy${NC}" ;;
            "unhealthy") echo -e "  $service: ${RED}unhealthy${NC}" ;;
            "starting") echo -e "  $service: ${YELLOW}starting${NC}" ;;
            *) echo -e "  $service: ${RED}$status${NC}" ;;
        esac
    done
}

cmd_build() {
    log_info "Building images..."
    cd "$DOCKER_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --no-cache "${@:-}"
    log_info "Build complete"
}

cmd_migrate() {
    log_info "Running database migrations..."
    cd "$DOCKER_DIR"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec bot \
        sh -c "cd /app/apps/bot && npx drizzle-kit migrate"
    log_info "Migrations complete"
}

cmd_ssl() {
    log_info "Setting up SSL certificates..."

    SSL_DIR="$DOCKER_DIR/nginx/ssl"
    mkdir -p "$SSL_DIR"

    if [[ ! -f "$SSL_DIR/fullchain.pem" ]]; then
        log_warn "No SSL certificates found. Generating self-signed for testing..."

        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$SSL_DIR/privkey.pem" \
            -out "$SSL_DIR/fullchain.pem" \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

        log_info "Self-signed certificate generated"
        log_warn "For production, use Let's Encrypt or your own certificates"
    else
        log_info "SSL certificates already exist"
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENV_FILE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        up|down|restart|logs|status|build|migrate|ssl)
            COMMAND=$1
            shift
            break
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Check environment file
check_env

# Execute command
case "${COMMAND:-}" in
    up) cmd_up ;;
    down) cmd_down ;;
    restart) cmd_restart ;;
    logs) cmd_logs "$@" ;;
    status) cmd_status ;;
    build) cmd_build "$@" ;;
    migrate) cmd_migrate ;;
    ssl) cmd_ssl ;;
    *)
        usage
        exit 1
        ;;
esac
