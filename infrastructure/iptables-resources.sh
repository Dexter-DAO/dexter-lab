#!/bin/bash
# iptables-resources.sh
#
# Blocks resource containers from reaching host services via the Docker gateway.
# Uses the DOCKER-USER chain, which Docker guarantees it will NEVER overwrite.
#
# What this does:
#   - Allows resource containers to talk to each other (Redis, Traefik on same network)
#   - BLOCKS resource containers from reaching ANY private IP outside their network
#     (dexter-api, facilitator, host Redis, Supabase, monitoring, mail, etc.)
#   - Allows resource containers to reach the public internet (for API Gateway, proxy calls)
#
# Usage:
#   ./iptables-resources.sh apply    # Apply rules
#   ./iptables-resources.sh remove   # Remove rules
#   ./iptables-resources.sh status   # Show current rules
#
# This script is called automatically by start-infrastructure.sh.
# Rules persist across container restarts but NOT across host reboots.
# For persistence across reboots, add to /etc/rc.local or use iptables-persistent.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Marker comment for our rules so we can identify and remove them
COMMENT="dexter-resource-isolation"

# Get the subnet and gateway of the dexter-resources Docker network dynamically
get_network_info() {
    local subnet gateway
    subnet=$(docker network inspect dexter-resources --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null)
    gateway=$(docker network inspect dexter-resources --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null)

    if [ -z "$subnet" ]; then
        echo -e "${RED}[ERROR]${NC} dexter-resources network not found. Start infrastructure first." >&2
        exit 1
    fi

    # Return both values
    echo "$subnet $gateway"
}

apply_rules() {
    local NET_INFO SUBNET GATEWAY
    NET_INFO=$(get_network_info)
    SUBNET=$(echo "$NET_INFO" | awk '{print $1}')
    GATEWAY=$(echo "$NET_INFO" | awk '{print $2}')
    echo -e "${GREEN}[INFO]${NC} Resource network: subnet=$SUBNET gateway=$GATEWAY"

    # Remove any existing rules first (idempotent)
    remove_rules 2>/dev/null || true

    # Find the bridge interface for this Docker network
    local NET_ID BRIDGE_IF
    NET_ID=$(docker network inspect dexter-resources --format '{{.Id}}' 2>/dev/null | cut -c1-12)
    BRIDGE_IF="br-${NET_ID}"

    # Verify the bridge interface exists
    if ! ip link show "$BRIDGE_IF" &>/dev/null; then
        echo -e "${RED}[ERROR]${NC} Bridge interface $BRIDGE_IF not found" >&2
        exit 1
    fi
    echo -e "${GREEN}[INFO]${NC} Bridge interface: $BRIDGE_IF"

    # =====================================================================
    # INPUT CHAIN: Block containers from initiating connections to the host
    # =====================================================================
    # When a container sends traffic to the gateway IP (e.g. 172.23.0.1),
    # that traffic is destined FOR the host, so it goes through INPUT,
    # NOT FORWARD/DOCKER-USER. We block NEW connections here.
    #
    # IMPORTANT: We must ACCEPT ESTABLISHED,RELATED traffic first!
    # Docker-proxy (port mapping) runs on the host and connects to containers.
    # Response packets from containers back to docker-proxy traverse INPUT.
    # Without this ACCEPT rule, Traefik port mapping (8090→80) breaks completely.
    #
    # This blocks containers from reaching dexter-api (:3030), facilitator
    # (:4072), host Redis (:6379), Supabase, mail, and every other host service.
    # =====================================================================

    # Allow responses to host-initiated connections (docker-proxy, health checks)
    sudo iptables -I INPUT 1 \
        -i "$BRIDGE_IF" \
        -s "$SUBNET" \
        -m conntrack --ctstate ESTABLISHED,RELATED \
        -j ACCEPT \
        -m comment --comment "$COMMENT"

    # Block containers from initiating NEW connections to the host
    sudo iptables -A INPUT \
        -i "$BRIDGE_IF" \
        -s "$SUBNET" \
        -m conntrack --ctstate NEW \
        -j DROP \
        -m comment --comment "$COMMENT"

    # =====================================================================
    # DOCKER-USER CHAIN: Block containers from reaching other private networks
    # =====================================================================
    # DOCKER-USER intercepts FORWARDED traffic (traffic being routed through
    # the host to other networks). This catches containers trying to reach:
    # - Other Docker bridge networks (Supabase, monitoring, etc.)
    # - AWS VPC private IPs
    # - AWS metadata service
    #
    # Rules are inserted with -I at position 1, so insert in REVERSE ORDER.
    # =====================================================================

    # Rule 5: DROP traffic to 169.254.169.254 (AWS metadata / SSRF protection)
    sudo iptables -I DOCKER-USER 1 \
        -s "$SUBNET" -d 169.254.169.254/32 \
        -j DROP \
        -m comment --comment "$COMMENT"

    # Rule 4: DROP traffic to 192.168.0.0/16 (private networks)
    sudo iptables -I DOCKER-USER 1 \
        -s "$SUBNET" -d 192.168.0.0/16 \
        -j DROP \
        -m comment --comment "$COMMENT"

    # Rule 3: DROP traffic to 10.0.0.0/8 (private networks)
    sudo iptables -I DOCKER-USER 1 \
        -s "$SUBNET" -d 10.0.0.0/8 \
        -j DROP \
        -m comment --comment "$COMMENT"

    # Rule 2: DROP traffic to 172.16.0.0/12 (all other Docker bridge gateways + AWS VPC)
    sudo iptables -I DOCKER-USER 1 \
        -s "$SUBNET" -d 172.16.0.0/12 \
        -j DROP \
        -m comment --comment "$COMMENT"

    # Rule 1 (TOP): RETURN traffic within the resource network
    # Container <-> container (Redis, Traefik) stays on the bridge and rarely
    # hits FORWARD, but this is a safety net.
    sudo iptables -I DOCKER-USER 1 \
        -s "$SUBNET" -d "$SUBNET" \
        -j RETURN \
        -m comment --comment "$COMMENT"

    echo -e "${GREEN}[INFO]${NC} Firewall rules applied."
    echo ""
    echo "  INPUT chain (stateful host access control via bridge $BRIDGE_IF):"
    sudo iptables -L INPUT -n --line-numbers | grep "$COMMENT"
    echo ""
    echo "  DOCKER-USER chain (blocks private network routing):"
    sudo iptables -L DOCKER-USER -n --line-numbers | grep "$COMMENT"
    echo ""
    echo "  Container network ($SUBNET) can reach:"
    echo "    [OK]  Other containers on same network (Redis, Traefik)"
    echo "    [OK]  Public internet (API Gateway upstream, proxy calls)"
    echo ""
    echo "  Container network ($SUBNET) BLOCKED from:"
    echo "    [--]  Host services via $GATEWAY (INPUT chain: dexter-api, facilitator, host Redis, mail)"
    echo "    [--]  172.16.0.0/12  (DOCKER-USER: all Docker bridges + AWS VPC)"
    echo "    [--]  10.0.0.0/8     (DOCKER-USER: private networks)"
    echo "    [--]  192.168.0.0/16 (DOCKER-USER: private networks)"
    echo "    [--]  169.254.169.254 (DOCKER-USER: AWS instance metadata / SSRF)"
}

remove_rules() {
    echo -e "${YELLOW}[INFO]${NC} Removing dexter resource isolation rules..."

    # Remove INPUT chain rules by comment marker
    while sudo iptables -L INPUT -n --line-numbers 2>/dev/null | grep -q "$COMMENT"; do
        local line
        line=$(sudo iptables -L INPUT -n --line-numbers | grep "$COMMENT" | tail -1 | awk '{print $1}')
        sudo iptables -D INPUT "$line"
    done

    # Remove DOCKER-USER chain rules by comment marker
    while sudo iptables -L DOCKER-USER -n --line-numbers 2>/dev/null | grep -q "$COMMENT"; do
        local line
        line=$(sudo iptables -L DOCKER-USER -n --line-numbers | grep "$COMMENT" | tail -1 | awk '{print $1}')
        sudo iptables -D DOCKER-USER "$line"
    done

    echo -e "${GREEN}[INFO]${NC} Rules removed."
}

show_status() {
    echo -e "${GREEN}[INFO]${NC} INPUT chain (host access blocking):"
    sudo iptables -L INPUT -n -v --line-numbers | grep "$COMMENT" || echo "  (no rules)"
    echo ""
    echo -e "${GREEN}[INFO]${NC} DOCKER-USER chain (private network blocking):"
    sudo iptables -L DOCKER-USER -n -v --line-numbers | grep "$COMMENT" || echo "  (no rules)"

    echo ""
    local count_input count_forward
    count_input=$(sudo iptables -L INPUT -n 2>/dev/null | grep -c "$COMMENT" || true)
    count_forward=$(sudo iptables -L DOCKER-USER -n 2>/dev/null | grep -c "$COMMENT" || true)
    local total=$((count_input + count_forward))

    if [ "$total" -gt 0 ]; then
        echo -e "${GREEN}[INFO]${NC} $total dexter resource isolation rules active ($count_input INPUT, $count_forward DOCKER-USER)."
    else
        echo -e "${RED}[WARN]${NC} No dexter resource isolation rules found! Run: $0 apply"
    fi
}

case "${1:-}" in
    apply)
        apply_rules
        ;;
    remove)
        remove_rules
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 {apply|remove|status}"
        exit 1
        ;;
esac
