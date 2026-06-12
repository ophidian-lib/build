#!/usr/bin/env bash
set -e  # Fail on unhandled errors

TAG_NAME=${GITHUB_REF##*/}
MANIFEST_VERSION=$(jq -r .version manifest.json)
MANIFEST_FILE=manifest.json

BUILD_DIR=dist
if [[ -d build && ! -d dist ]]; then
    BUILD_DIR=build
fi

# Check if beta manifest is newer: if so, use that for the release
# (so betas can be made public later and have the right version number)
#
if [[ -f manifest-beta.json ]]; then
    BETA_VERSION=$(jq -r .version manifest-beta.json)
    if jq --arg v1 "$BETA_VERSION" --arg v2 "$MANIFEST_VERSION" -ne '($v1|split(".")) > ($v2|split("."))' >/dev/null; then
        MANIFEST_VERSION="$BETA_VERSION"
        MANIFEST_FILE=manifest-beta.json
        cp manifest-beta.json manifest.json
    fi
fi

if [[ "$MANIFEST_VERSION" != "$TAG_NAME" ]]; then
    echo "ERROR: Commit is tagged '$TAG_NAME' but $MANIFEST_FILE version is '$MANIFEST_VERSION'"
    exit 1
fi

PACKAGER=$(jq -r '.packageManager // "npm"' package.json)
PACKAGER=${PACKAGER%@*}

"$PACKAGER" install
"$PACKAGER" "${BUILD_SCRIPT}"

# Move built files to project root
for f in main.js styles.css; do
    if [[ -f "$BUILD_DIR/$f" && ! -f "$f" ]]; then
        mv "$BUILD_DIR"/$f $f;
    fi
done

if [[ -f styles.css ]]; then
    echo "styles=styles.css"
else
    echo "styles="
fi >> "$GITHUB_OUTPUT"
