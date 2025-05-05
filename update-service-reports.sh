#!/usr/bin/env bash
# update-service-reports.sh — Generate DegenDuel service architecture reports

set -euo pipefail
IFS=

trap 'echo >&2 "Script failed unexpectedly. See error above."' ERR

# ---- Configurable vars ----
TODAY=$(date '+%Y%m%d')
OUT_DIR="./reports/service-architecture"
AUDIT_SCRIPT="./service-audit.sh"
JSON_FILE="service-architecture-audit.json"
MD_FILE="SERVICE_ARCHITECTURE.md"

# ---- Helpers ----
die() { echo >&2 "✖ ERROR: $*"; exit 1; }

ensure_exec() {
  [[ -x "$1" ]] || die "'$1' not found or not executable"
}

run_audit() {
  mkdir -p "$OUT_DIR"
  echo "Running service architecture audit..."
  "$AUDIT_SCRIPT" > "$OUT_DIR/audit-${TODAY}.txt"
}

summarize() {
  local report="$OUT_DIR/audit-${TODAY}.txt"
  echo
  echo "===== Service Architecture Audit Summary ($TODAY) ====="
  grep -c "extends BaseService" "$report" | xargs printf "• Total services: %s\n"
  grep -c "extends BaseService but doesn't call super.initialize()" "$report" | xargs printf "• Missing super.initialize(): %s\n"
  grep -c "doesn't use handleError method" "$report" | xargs printf "• Missing handleError(): %s\n"
  grep -c "may have unsafe stats access without null checks" "$report" | xargs printf "• Unsafe stats access: %s\n"
  grep -c "creates new PrismaClient instance" "$report" | xargs printf "• PrismaClient issues: %s\n"
  grep -c "Potential circular import detected" "$report" | xargs printf "• Circular deps: %s\n"
  echo
  echo "Full report → $report"
}

update_dates() {
  echo "Updating timestamps in JSON/MD files..."
  sed -i "s/\"lastAuditDate\": *\"[0-9-]\+\"/\"lastAuditDate\": \"${TODAY:0:4}-${TODAY:4:2}-${TODAY:6:2}\"/" "$JSON_FILE"
  sed -i "s/conducted on [0-9-]\{4\}-[0-9]\{2\}-[0-9]\{2\}/conducted on ${TODAY:0:4}-${TODAY:4:2}-${TODAY:6:2}/" "$MD_FILE"
}

# ---- Main ----
echo "===== Generating DegenDuel Service Architecture Reports ====="
ensure_exec "$AUDIT_SCRIPT"
run_audit
summarize
update_dates

echo
echo "===== Done ====="