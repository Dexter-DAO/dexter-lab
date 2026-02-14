#!/bin/bash
# Cleanup zombie Node processes safely
# Run with: pnpm run zombies
#
# ROOT CAUSE: Supabase Docker containers (studio + pg_meta) don't include
# an init system, so their Node PID 1 never reaps children. This is upstream.
# Restarting the containers is the proper fix. This script handles the rest.

set -e

echo "🧹 Zombie cleanup..."

ZOMBIE_COUNT=$(ps aux | grep -c '\[node\] <defunct>' 2>/dev/null || echo 0)
# grep -c counts the grep line itself sometimes, subtract 1 if needed
ZOMBIE_COUNT=$(ps -eo stat | grep -c '^Z' 2>/dev/null || echo 0)

echo "  Zombies found: $ZOMBIE_COUNT"

if [ "$ZOMBIE_COUNT" -eq 0 ]; then
  echo "✅ No zombies"
  exit 0
fi

# Identify parents
echo ""
echo "  Zombie parents:"
ps -eo pid,ppid,stat,comm | grep ' Z ' | awk '{print $2}' | sort | uniq -c | sort -rn | while read count ppid; do
  CMD=$(ps -o comm= -p $ppid 2>/dev/null || echo "dead")
  echo "    PID $ppid ($CMD): $count zombies"
done

# Check if parents are Supabase containers (don't kill those)
SUPABASE_PIDS=""
for ppid in $(ps -eo pid,ppid,stat | grep ' Z$' | awk '{print $2}' | sort -u); do
  CMD=$(ps -o args= -p $ppid 2>/dev/null || echo "")
  if echo "$CMD" | grep -qE 'next-server|dist/server/server\.js|apps/studio'; then
    SUPABASE_PIDS="$SUPABASE_PIDS $ppid"
  fi
done

if [ ! -z "$SUPABASE_PIDS" ]; then
  echo ""
  echo "  ⚠️  Most zombies are from Supabase Docker containers."
  echo "  These can only be cleaned by restarting the containers:"
  echo ""
  echo "    docker restart supabase_studio_supabase supabase_studio_pumpstreams"
  echo "    docker restart supabase_pg_meta_supabase supabase_pg_meta_pumpstreams"
  echo ""

  if [ "$1" = "--restart-supabase" ]; then
    echo "  Restarting Supabase containers..."
    docker restart supabase_studio_supabase supabase_studio_pumpstreams 2>/dev/null || true
    docker restart supabase_pg_meta_supabase supabase_pg_meta_pumpstreams 2>/dev/null || true
    sleep 3
    NEW_COUNT=$(ps -eo stat | grep -c '^Z' 2>/dev/null || echo 0)
    echo "  ✅ Done. Zombies remaining: $NEW_COUNT"
  else
    echo "  Run with --restart-supabase to fix automatically."
  fi
fi

# Kill non-supabase zombie parents (safe ones)
for ppid in $(ps -eo pid,ppid,stat | grep ' Z$' | awk '{print $2}' | sort -u); do
  CMD=$(ps -o args= -p $ppid 2>/dev/null || echo "")
  if ! echo "$CMD" | grep -qE 'next-server|dist/server/server\.js|apps/studio'; then
    if [ "$ppid" != "1" ]; then
      echo "  Killing non-essential zombie parent $ppid ($CMD)"
      kill -9 $ppid 2>/dev/null || true
    fi
  fi
done

echo ""
echo "✅ Cleanup complete"
