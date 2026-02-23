#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DOCKER_DIR="$PROJECT_ROOT/docker"
SSL_DIR="$DOCKER_DIR/nginx/ssl"

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN    Domain name (required)"
    echo "  -e, --email EMAIL      Email for Let's Encrypt (required)"
    echo "  -s, --staging          Use Let's Encrypt staging environment"
    echo "  -h, --help             Show this help"
    echo ""
    echo "Example:"
    echo "  $0 -d wallet.example.com -e admin@example.com"
}

DOMAIN=""
EMAIL=""
STAGING=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain) DOMAIN="$2"; shift 2 ;;
        -e|--email) EMAIL="$2"; shift 2 ;;
        -s|--staging) STAGING="--staging"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) log_error "Unknown option: $1"; usage; exit 1 ;;
    esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
    log_error "Domain and email are required"
    usage
    exit 1
fi

log_info "Setting up SSL certificate for $DOMAIN"

# Create directories
mkdir -p "$SSL_DIR"
mkdir -p "$DOCKER_DIR/certbot/www"
mkdir -p "$DOCKER_DIR/certbot/conf"

# Check if certbot is installed
if ! command -v certbot &> /dev/null; then
    log_warn "Certbot not found. Installing via Docker..."

    # Run certbot via Docker
    docker run --rm \
        -v "$DOCKER_DIR/certbot/www:/var/www/certbot" \
        -v "$DOCKER_DIR/certbot/conf:/etc/letsencrypt" \
        -p 80:80 \
        certbot/certbot certonly \
        --standalone \
        --preferred-challenges http \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        $STAGING

    # Copy certificates
    cp "$DOCKER_DIR/certbot/conf/live/$DOMAIN/fullchain.pem" "$SSL_DIR/"
    cp "$DOCKER_DIR/certbot/conf/live/$DOMAIN/privkey.pem" "$SSL_DIR/"

else
    # Use local certbot
    sudo certbot certonly \
        --standalone \
        --preferred-challenges http \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --no-eff-email \
        $STAGING

    # Copy certificates
    sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$SSL_DIR/"
    sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$SSL_DIR/"
    sudo chown "$(whoami)" "$SSL_DIR"/*.pem
fi

log_info "SSL certificate installed successfully!"
log_info "Certificates location: $SSL_DIR"
log_info ""
log_info "To auto-renew, add this cron job:"
log_info "  0 0 1 * * $SCRIPT_DIR/setup-ssl.sh -d $DOMAIN -e $EMAIL"
