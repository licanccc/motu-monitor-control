#!/bin/zsh
set -euo pipefail

DESTINATION="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.local.motu-monitor.sdPlugin"
if [[ -d "$DESTINATION" ]]; then
  mv "$DESTINATION" "$HOME/.Trash/com.local.motu-monitor.sdPlugin.$(date +%Y%m%d-%H%M%S)"
  echo "插件已移到废纸篓。重新打开 Stream Deck 后生效。"
else
  echo "没有找到已安装的插件。"
fi
