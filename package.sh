#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EXTENSION_NAME="ollama-usage"
ZIP_FILE="${EXTENSION_NAME}.zip"

make all
PACKAGE_DIR=$(mktemp -d)
trap 'rm -rf "$PACKAGE_DIR"' EXIT

# Files to include in the zip
FILES=(
    "extension.js"
    "metadata.json"
    "prefs.js"
    "accounts.js"
    "client.js"
    "usage.js"
    "stylesheet.css"
    "LICENSE"
    "README.md"
    "README.zh_CN.md"
    "schemas"
    "locale"
)

echo "Packaging ${EXTENSION_NAME}..."

# Create zip with only necessary files
zip -r "${PACKAGE_DIR}/${ZIP_FILE}" "${FILES[@]}" \
    -x "*/.git*" \
    -x "*/.jj*" \
    -x "*~" \
    -x "*.bak" \
    -x "*.swp" \
    -x "*/__pycache__/*" \
    -x "schemas/gschemas.compiled"

mv "${PACKAGE_DIR}/${ZIP_FILE}" "${ZIP_FILE}"

echo "Created ${ZIP_FILE}"
echo "Contents:"
unzip -l "${ZIP_FILE}"
