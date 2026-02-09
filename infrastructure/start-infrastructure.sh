#!/bin/bash
# Start Dexter Lab x402 Resource Infrastructure
#
# This script:
# 1. Creates the Docker network if it doesn't exist
# 2. Starts Traefik and Redis via docker-compose
# 3. Verifies health of services
#
# Usage:
#   ./infrastructure/start-infrastructure.sh
#   ./infrastructure/start-infrastructure.sh --stop
#   ./infrastructure/start-infrastructure.sh --status

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.resources.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    
    log_info "Docker is available"
}

# Create the resource network if it doesn't exist
create_network() {
    if ! docker network inspect dexter-resources &> /dev/null; then
        log_info "Creating dexter-resources network..."
        docker network create --driver bridge dexter-resources
    else
        log_info "Network dexter-resources already exists"
    fi
}

# Apply iptables rules to block container access to host services
apply_firewall() {
    local SCRIPT_DIR_FW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local FW_SCRIPT="$SCRIPT_DIR_FW/iptables-resources.sh"

    if [ -f "$FW_SCRIPT" ]; then
        log_info "Applying DOCKER-USER iptables rules..."
        bash "$FW_SCRIPT" apply
    else
        log_warn "Firewall script not found at $FW_SCRIPT -- host services are NOT protected!"
        log_warn "Resource containers can reach dexter-api, Redis, Supabase, etc."
    fi
}

# Start infrastructure services
start_services() {
    log_info "Starting Traefik and Redis..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 5
    
    # Check Traefik health
    if curl -sf http://localhost:8081/ping > /dev/null 2>&1; then
        log_info "Traefik is healthy"
    else
        log_warn "Traefik health check pending..."
        sleep 5
        if curl -sf http://localhost:8081/ping > /dev/null 2>&1; then
            log_info "Traefik is healthy"
        else
            log_error "Traefik health check failed"
        fi
    fi
    
    # Check Redis health (now requires auth)
    if docker exec dexter-redis redis-cli -a "${DEXTER_REDIS_PASSWORD:-changeme_dexter_redis_2026}" ping 2>/dev/null | grep -q PONG; then
        log_info "Redis is healthy (authenticated)"
    else
        log_error "Redis health check failed"
    fi
}

# Stop infrastructure services
stop_services() {
    log_info "Stopping infrastructure services..."
    docker-compose -f "$COMPOSE_FILE" down
    log_info "Infrastructure stopped"
}

# Show status of services
show_status() {
    log_info "Infrastructure Status:"
    echo ""
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    
    log_info "Resource Containers:"
    docker ps --filter "label=dexter.resource.type=x402" --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    
    log_info "Network Info:"
    docker network inspect dexter-resources --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{"\n"}}{{end}}' 2>/dev/null || echo "No containers in network"

    log_info "DOCKER-USER firewall rules:"
    sudo iptables -L DOCKER-USER -n -v 2>/dev/null | grep -E 'dexter|DROP' || echo "No dexter-specific rules found"
}

# Main
case "${1:-start}" in
    start)
        check_docker
        create_network
        start_services
        apply_firewall
        log_info "Infrastructure is ready!"
        log_info "Traefik dashboard: http://localhost:8082"
        log_info "Resource traffic: port 8090 -> Traefik -> containers"
        ;;
    stop)
        stop_services
        ;;
    status)
        show_status
        ;;
    restart)
        stop_services
        sleep 2
        check_docker
        create_network
        start_services
        apply_firewall
        log_info "Infrastructure restarted!"
        ;;
    *)
        echo "Usage: $0 {start|stop|status|restart}"
        exit 1
        ;;
esac
