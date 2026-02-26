#!/bin/bash
# Backfill ERC-8004 identities on the OFFICIAL 8004scan registry
# for all running Lab resources that don't have an agent ID.
# Mints sequentially with a 5-second gap between each.

set -euo pipefail

INTERNAL_KEY=$(grep INTERNAL_API_KEY /home/branchmanager/websites/dexter-lab/.env | cut -d= -f2)
LAB_SECRET=$(grep LAB_INTERNAL_SECRET /home/branchmanager/websites/dexter-lab/.env | cut -d= -f2)
API="https://api.dexter.cash"
REGISTRY="eip155:8453:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"

echo "Fetching resources without identities..."

RESOURCES=$(curl -s "$API/api/dexter-lab/resources" \
  -H "Authorization: Bearer $LAB_SECRET" | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
resources = data if isinstance(data, list) else data.get('resources', data.get('data', []))
for r in resources:
    if r.get('status') == 'running' and not r.get('erc8004_agent_id'):
        print(json.dumps({
            'id': r['id'],
            'name': r.get('name',''),
            'description': (r.get('description','') or '')[:200],
            'public_url': r.get('public_url',''),
            'pay_to_wallet': r.get('pay_to_wallet',''),
        }))
")

TOTAL=$(echo "$RESOURCES" | grep -c '{' || true)
echo "Found $TOTAL resources to mint."
echo ""

SUCCESS=0
FAIL=0
INDEX=0

echo "$RESOURCES" | while IFS= read -r line; do
    [ -z "$line" ] && continue
    INDEX=$((INDEX + 1))

    ID=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
    NAME=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['name'])")
    DESC=$(echo "$line" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['description']))")
    URL=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['public_url'])")
    WALLET=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin)['pay_to_wallet'])")

    echo "[$INDEX/$TOTAL] Minting $NAME ($ID)..."

    RESULT=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API/api/identity/mint" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $LAB_SECRET" \
        -H "X-Internal-Key: $INTERNAL_KEY" \
        -d "{
            \"chain\": \"base\",
            \"name\": \"$NAME\",
            \"description\": $DESC,
            \"walletAddress\": \"$WALLET\",
            \"services\": [
                {\"name\": \"x402\", \"endpoint\": \"$URL\", \"version\": \"v2\"},
                {\"name\": \"A2A\", \"endpoint\": \"$API/api/dexter-lab/resources/$ID/agent.json\", \"version\": \"0.2.1\"}
            ]
        }")

    HTTP_CODE=$(echo "$RESULT" | grep "HTTP_CODE:" | cut -d: -f2)
    RESPONSE=$(echo "$RESULT" | grep -v "HTTP_CODE:")

    if [ "$HTTP_CODE" = "201" ]; then
        AGENT_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('identity',{}).get('agentId',''))" 2>/dev/null)
        PARSED_ID=$(python3 -c "print(int('$AGENT_ID'))" 2>/dev/null || echo "")

        if [ -n "$PARSED_ID" ] && [ "$PARSED_ID" != "" ]; then
            echo "  -> agent #$PARSED_ID on official registry"

            # Persist to resource record
            curl -s "$API/api/dexter-lab/resources/$ID" \
                -X PATCH \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $LAB_SECRET" \
                -d "{\"erc8004_agent_id\": $PARSED_ID, \"erc8004_agent_registry\": \"$REGISTRY\"}" > /dev/null 2>&1

            SUCCESS=$((SUCCESS + 1))
        else
            echo "  -> Minted but could not parse agent ID from response"
            FAIL=$((FAIL + 1))
        fi
    else
        ERROR=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','unknown')[:120])" 2>/dev/null || echo "unknown")
        echo "  -> FAILED (HTTP $HTTP_CODE): $ERROR"
        FAIL=$((FAIL + 1))
    fi

    sleep 5
done

echo ""
echo "Done."
