#!/usr/bin/env bash
# Figma Text Pusher — CLI
# Usage:
#   ./push.sh test-copy.json          Push text updates to Figma
#   ./push.sh --health                Check server and plugin status
#   ./push.sh --list                  List all text nodes with their content
#   ./push.sh --list --frame "Name"   List text nodes in a specific frame
#   ./push.sh --rename rename.json    Rename layers using a mapping file

set -euo pipefail

SERVER="http://localhost:3001"
FRAME=""
ACTION="push"

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --health)
      ACTION="health"
      shift
      ;;
    --list)
      ACTION="list"
      shift
      ;;
    --rename)
      ACTION="rename"
      shift
      ;;
    --frame)
      FRAME="${2:-}"
      shift 2
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      FILE="$1"
      shift
      ;;
  esac
done

# ── Health check ──────────────────────────────────────────────────────────────
if [[ "$ACTION" == "health" ]]; then
  RESPONSE=$(curl -sf "$SERVER/health" 2>/dev/null) || {
    echo "Bridge server: ✗ not running (start with: cd server && npm start)"
    exit 1
  }

  PLUGIN=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('plugin','unknown'))")
  PAGE=$(echo "$RESPONSE"   | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('page','—'))" 2>/dev/null || echo "—")
  COUNT=$(echo "$RESPONSE"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('textNodeCount','—'))" 2>/dev/null || echo "—")

  echo "Bridge server: ✅ running on :3001"

  if [[ "$PLUGIN" == "connected" ]]; then
    echo "Plugin:        ✅ connected"
    echo "Page:          \"$PAGE\""
    echo "Text nodes:    $COUNT"
  else
    echo "Plugin:        ✗ disconnected (open the plugin in Figma)"
  fi
  exit 0
fi

# ── List nodes ────────────────────────────────────────────────────────────────
if [[ "$ACTION" == "list" ]]; then
  if [[ -n "$FRAME" ]]; then
    BODY="{\"frame\": \"$FRAME\"}"
    LABEL="in frame \"$FRAME\""
  else
    BODY="{}"
    LABEL="on current page"
  fi

  RESPONSE=$(curl -sf -X POST "$SERVER/list" \
    -H "Content-Type: application/json" \
    -d "$BODY" 2>/dev/null) || {
    echo "✗ Could not reach bridge server at $SERVER" >&2
    exit 1
  }

  HTTP_STATUS=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")
  if [[ -n "$HTTP_STATUS" ]]; then
    echo "✗ Error: $HTTP_STATUS" >&2
    exit 1
  fi

  echo "Text nodes $LABEL:"
  echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
nodes = d.get('nodes', [])
if not nodes:
    print('  (none found)')
else:
    for n in nodes:
        name    = n.get('name', '?') if isinstance(n, dict) else n
        content = n.get('content', '') if isinstance(n, dict) else ''
        content_preview = (content[:50] + '…') if len(content) > 50 else content
        print(f'  • {name:<30}  \"{content_preview}\"')
print()
print(len(nodes), 'node(s) total')
"
  exit 0
fi

# ── Rename layers ─────────────────────────────────────────────────────────────
if [[ "$ACTION" == "rename" ]]; then
  if [[ -z "${FILE:-}" ]]; then
    echo "Usage: $0 --rename <mapping.json>" >&2
    echo ""
    echo "mapping.json format:"
    echo '  { "old layer name": "new_layer_name", ... }'
    exit 1
  fi

  if [[ ! -f "$FILE" ]]; then
    echo "✗ File not found: $FILE" >&2
    exit 1
  fi

  KEY_COUNT=$(python3 -c "import json; d=json.load(open('$FILE')); print(len(d))")
  echo "Renaming $KEY_COUNT layer(s) in Figma…"
  echo ""

  HTTP_CODE=$(curl -s -o /tmp/figma_rename_response.json -w "%{http_code}" \
    -X POST "$SERVER/rename" \
    -H "Content-Type: application/json" \
    -d "@$FILE" 2>/dev/null) || {
    echo "✗ Could not reach bridge server at $SERVER" >&2
    exit 1
  }

  case "$HTTP_CODE" in
    503) echo "✗ No Figma plugin connected." >&2; exit 1 ;;
    504) echo "✗ Plugin timed out." >&2; exit 1 ;;
    200) ;;
    *) echo "✗ Unexpected HTTP $HTTP_CODE" >&2; exit 1 ;;
  esac

  python3 << PYEOF
import json
with open('/tmp/figma_rename_response.json') as f:
    data = json.load(f)

results = data.get('results', [])
renamed = 0
not_found = 0

for r in results:
    old  = r.get('oldName', '?')
    new  = r.get('newName', '?')
    status = r.get('status', 'error')
    if status == 'renamed':
        print(f'  ✅ "{old}"  →  "{new}"')
        renamed += 1
    else:
        print(f'  ✗  "{old}"  (not found)')
        not_found += 1

print()
print(f'Done: {renamed} renamed, {not_found} not found')
PYEOF
  exit 0
fi

# ── Push text updates ─────────────────────────────────────────────────────────
if [[ -z "${FILE:-}" ]]; then
  echo "Usage: $0 <file.json> | --health | --list [--frame \"Name\"] | --rename <mapping.json>" >&2
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "✗ File not found: $FILE" >&2
  exit 1
fi

# Validate JSON
python3 -c "import json,sys; json.load(open('$FILE'))" 2>/dev/null || {
  echo "✗ Invalid JSON in $FILE" >&2
  exit 1
}

KEY_COUNT=$(python3 -c "import json; d=json.load(open('$FILE')); print(len(d))")
echo "Pushing $KEY_COUNT keys to Figma…"
echo ""

HTTP_CODE=$(curl -s -o /tmp/figma_push_response.json -w "%{http_code}" \
  -X POST "$SERVER/push" \
  -H "Content-Type: application/json" \
  -d "@$FILE" 2>/dev/null) || {
  echo "✗ Could not reach bridge server at $SERVER"
  echo "  Is it running? Try: cd server && npm start"
  exit 1
}

RESPONSE=$(cat /tmp/figma_push_response.json)

case "$HTTP_CODE" in
  503)
    echo "✗ No Figma plugin connected."
    echo "  Open Figma, run the Text Pusher plugin, wait for 'Connected'"
    exit 1
    ;;
  504)
    echo "✗ Plugin timed out (30s). Is Figma open and responsive?"
    exit 1
    ;;
  200)
    ;;
  *)
    echo "✗ Unexpected HTTP $HTTP_CODE from server:"
    echo "$RESPONSE"
    exit 1
    ;;
esac

# Parse and display results
python3 << PYEOF
import json, sys

with open('/tmp/figma_push_response.json') as f:
    data = json.load(f)

results = data.get('results', [])
updated = 0
not_found = 0
errors = 0

for r in results:
    key    = r.get('key', '?')
    status = r.get('status', 'error')
    error  = r.get('error', '')

    if status == 'updated':
        # Read the original value from the push file
        with open('$FILE') as jf:
            values = json.load(jf)
        val = values.get(key, '')
        print(f'  ✅ {key:<22} → "{val}"')
        updated += 1
    elif status == 'not_found':
        print(f'  ✗  {key:<22}   (layer not found — check name in Figma)')
        not_found += 1
    else:
        print(f'  ⚠  {key:<22}   error: {error}')
        errors += 1

print()
print(f'Done: {updated} updated, {not_found} not found, {errors} errors')
PYEOF
