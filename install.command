#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
SOURCE="$SCRIPT_DIR/com.local.motu-monitor.sdPlugin"
DESTINATION="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/com.local.motu-monitor.sdPlugin"

if grep -q 'REPLACE_WITH_DEVICE_SERIAL' "$SOURCE/config.json"; then
  echo "请先编辑 com.local.motu-monitor.sdPlugin/config.json，填入 UltraLite mk5 的设备序列号。"
  exit 1
fi

mkdir -p "${DESTINATION:h}"
if [[ -d "$DESTINATION" ]]; then
  BACKUP="$DESTINATION.backup.$(date +%Y%m%d-%H%M%S)"
  mv "$DESTINATION" "$BACKUP"
  echo "旧版本已备份到：$BACKUP"
fi
cp -R "$SOURCE" "$DESTINATION"
echo "安装完成。请退出并重新打开 Stream Deck，然后把需要的九个动作拖到按键上。"
open -a "Elgato Stream Deck"
