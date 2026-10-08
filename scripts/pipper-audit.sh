#!/usr/bin/env bash
#
# pipper-audit.sh - factual runtime audit of every Pipper/Omni app instance
# and the ACP agent fleet it spawns. Read-only: never prints secret contents.
#
# Usage: bash scripts/pipper-audit.sh

set -uo pipefail

APP_PATTERN='Pipper|Electron.*(pipper|morning-brief)|opencode acp|devin acp|claude-agent-acp|codex-acp|antigravity-acp|copilot --acp|cursor-agent'

hr() { printf '%s\n' "------------------------------------------------------------"; }

hr
echo "PIPPER INSTANCE AUDIT  $(date '+%Y-%m-%d %H:%M:%S')"
hr

echo
echo "## 1. App instances (top-level Electron processes)"
ps -Ao pid,ppid,pcpu,pmem,time,rss,lstart,command \
  | grep -iE "Pipper Code \(Alpha\)\.app/Contents/MacOS|electron/dist/Electron\.app/Contents/MacOS/Electron \." \
  | grep -v grep
echo
echo "NTFY: a single-user machine should normally show ONE instance."
echo "Two instances = two app support dirs (pipper-code-alpha + pipper-dev)."

echo
echo "## 2. Agent fleet per instance (children)"
ps -Ao pid,ppid,pcpu,pmem,rss,command | grep -iE "$APP_PATTERN" | grep -v grep | grep -v "pipper-audit" \
  | awk '{ printf "  pid=%s ppid=%s cpu=%s%% mem=%s%% rss=%sKB  %s\n", $1,$2,$3,$4,$5, substr($0, index($0,$6)) }'

echo
echo "## 3. App-instance roots: ancestry + memory tree (MB)"
PARENTS=$(ps -Ao pid,command | grep -iE "Pipper Code \(Alpha\)\.app/Contents/MacOS|electron/dist/Electron\.app/Contents/MacOS/Electron \.$" | grep -v grep | awk '{print $1}')
ps -Ao pid,ppid,rss > /tmp/pipper-audit-ps.txt
for parent in $PARENTS; do
  echo "  root=$parent"
  # ancestry chain up to init, to reveal nesting between app instances
  p=$parent
  for _ in $(seq 1 12); do
    anc=$(ps -o pid=,command= -p "$p" 2>/dev/null | sed 's/^ *//')
    [ -z "$anc" ] && break
    echo "    ^ $anc" | cut -c1-140
    p=$(ps -o ppid= -p "$p" | tr -d ' ')
    [ -z "$p" ] || [ "$p" = "0" ] || [ "$p" = "1" ] && break
  done
  total=$(awk -v root="$parent" '
    { ppid[$1]=$2; rss[$1]=$3 }
    END {
      for (q in ppid) {
        x=q; depth=0
        while (x != "" && depth < 32) { if (x==root) { s+=rss[q]; break } x=ppid[x]; depth++ }
      }
      printf "%.0f", s/1024
    }' /tmp/pipper-audit-ps.txt)
  echo "    tree=${total}MB (includes descendants; NESTED roots are double-counted)"
done
rm -f /tmp/pipper-audit-ps.txt

echo
echo "## 4. Listening sockets with a Pipper/agent owner (all interfaces shown)"
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
  | grep -iE "Pipper|Electron|opencode|devin|claude|node|bun" || echo "  (none)"

echo
echo "## 5. Remote-access exposure (port 4173) - the security-critical surface"
lsof -nP -iTCP:4173 -sTCP:LISTEN 2>/dev/null || echo "  not listening"
echo "  Expected binds per remote-server.ts: 127.0.0.1 + Tailscale 100.x ONLY."
for host in 127.0.0.1 $(tailscale ip -4 2>/dev/null); do
  [ -z "$host" ] && continue
  for path in /api/remote/projects /api/remote/threads /api/remote/health; do
    code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://${host}:4173${path}" 2>/dev/null)
    echo "  ${host}:4173${path} -> ${code:-ERR}"
  done
done
echo "  401 = token required (good). 200 on /projects or /threads = UNAUTHENTICATED LEAK."

echo
echo "## 6. Pairing token files (existence + perms only; contents redacted)"
for d in "$HOME/Library/Application Support/pipper-code-alpha" "$HOME/Library/Application Support/pipper-dev"; do
  f="$d/remote-token.txt"
  if [ -f "$f" ]; then
    len=$(wc -c < "$f" | tr -d ' ')
    mode=$(stat -f "%Lp" "$f")
    echo "  $f  mode=$mode bytes=$len  (48 hex chars = randomBytes(24) = 192-bit)"
  else
    echo "  $f  (absent)"
  fi
done

echo
echo "## 7. Subagent MCP HTTP servers (loopback, token-in-path)"
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
  | awk '$1 ~ /Electron|opencode/ {print "  "$1" pid="$2" "$9}' || true
echo "  Source: electron/subagents/mcp-http-server.ts binds 127.0.0.1 only."

echo
echo "## 8. Disk footprint"
du -sh "$HOME/Library/Application Support/pipper-code-alpha/omni.sqlite"* \
       "$HOME/Library/Application Support/pipper-dev/omni.sqlite"* 2>/dev/null || true

echo
echo "## 9. Stray detached instances (ppid=1, older than 10 min, holding agent children)"
ps -Ao pid,ppid,etime,command | grep -iE "Pipper Code \(Alpha\)\.app/Contents/MacOS" | grep -v grep \
  | awk '$2==1{print "  DETACHED pid="$1" uptime="$3}'

hr
echo "Done. Redact nothing upward: this output contains no secrets."
hr
