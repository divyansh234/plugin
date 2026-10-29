#!/bin/bash
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
rm -rf "$EXT/FolderDrop"
mkdir -p "$EXT/Dropzone"; cp -R "$(dirname "$0")/Dropzone/." "$EXT/Dropzone"
echo "Installed. Restart Premiere Pro, then Window > Extensions > Dropzone"
