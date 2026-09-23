#!/bin/zsh
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${0:A}")/.." && pwd -P)"
WEB_HOME="${CODEX_CHATGPT_WEB_HOME:-$HOME/.codex-chatgpt-web}"
BUN="${COHAB_BUN:-$WEB_HOME/versions/5.0.8-darwin-arm64/runtime/bun}"
PLIST="$HOME/Library/LaunchAgents/com.opencodex.proxy.plist"
LABEL="com.opencodex.proxy"
UID="$(id -u)"
BACKUPS="$HOME/.opencodex/backups"
WRAPPER_DIR="$HOME/.local/bin"
WRAPPER="$WRAPPER_DIR/cohab"
ZSHRC="$HOME/.zshrc"

[[ -x "$BUN" ]] || {
  print -u2 -- "Bun 1.4.0 absent: $BUN"
  print -u2 -- "Lance d'abord /Applications/Codex Web GPT.app."
  exit 1
}

if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
  print -u2 -- "Le LaunchAgent est actif. Exécute 'cohab adopt' après la tâche Codex en cours."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$BACKUPS" "$WRAPPER_DIR"
if [[ -f "$PLIST" ]]; then
  cp "$PLIST" "$BACKUPS/com.opencodex.proxy-before-cohab-$(date +%Y%m%d-%H%M%S).plist"
fi

TOKEN="$HOME/.opencodex/service-api-token"
CLI="$ROOT/src/cli/index.ts"
COMMAND="if [ -r '$TOKEN' ]; then OPENCODEX_API_AUTH_TOKEN=\"\$(cat '$TOKEN')\"; export OPENCODEX_API_AUTH_TOKEN; fi; exec '$BUN' '$CLI' start --port 10100"
TMP="$(mktemp "$HOME/Library/LaunchAgents/.com.opencodex.proxy.XXXXXX")"
cat > "$TMP" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>$COMMAND</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OCX_SERVICE</key><string>1</string>
    <key>OCX_SERVICE_MANAGED</key><string>1</string>
    <key>OCX_BUN_RUNTIME_SOURCE</key><string>override</string>
    <key>OCX_BUN_RUNTIME_PATH</key><string>$BUN</string>
    <key>CODEX_HOME</key><string>$HOME/.codex</string>
    <key>OPENCODEX_HOME</key><string>$HOME/.opencodex</string>
    <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$HOME/.opencodex/cohab-launchd.log</string>
  <key>StandardErrorPath</key><string>$HOME/.opencodex/cohab-launchd.log</string>
</dict>
</plist>
EOF
plutil -lint "$TMP" >/dev/null
mv "$TMP" "$PLIST"
chmod 600 "$PLIST"

cat > "$WRAPPER" <<EOF
#!/bin/zsh
exec "$ROOT/scripts/cohab" "\$@"
EOF
chmod 755 "$WRAPPER"

MARKER='# OpenCodex cohabitation command'
if ! rg -Fqx "$MARKER" "$ZSHRC" 2>/dev/null; then
  {
    print
    print -- "$MARKER"
    print -- "alias cohab=\"$WRAPPER\""
  } >> "$ZSHRC"
fi

print -- "LaunchAgent préparé: $PLIST"
print -- "Commande installée: $WRAPPER"
print -- "Après la tâche Codex en cours, exécute: cohab adopt"
