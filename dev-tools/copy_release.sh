#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <destination>"
    exit 1
fi

DEST="$1"

# Directory containing this script
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Find the Git repository root based on the script location
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || {
    echo "Error: script is not located inside a Git repository." >&2
    exit 1
}

# Create destination and convert it to an absolute path
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

# Format:
#   "source"
#       -> copied with the same relative path/name
#
#   "source:target"
#       -> copied and renamed/moved to target
#
# All source paths are relative to the repository root.
# All target paths are relative to the destination directory.
ITEMS=(
    "dev-tools"
    "graupel"
    "LICENSES"
	"react"
	"tests"
	".flake8"
	".gitignore"
	"DEVELOPER.md"
	"LICENSE"
	"Makefile.public:Makefile"
	"pyproject.toml"
	"MANIFEST.in"
	"README.md"
    "THIRD_PARTY_LICENSES.md"

    # Examples:
    # "pyproject.toml"
    # "release/pyproject.toml:pyproject.toml"
    # "release/README_PYPI.md:README.md"
    # "graupel/icons:assets/icons"
)

echo "Source:      $REPO_ROOT"
echo "Destination: $DEST"
echo

for mapping in "${ITEMS[@]}"; do
    # If no colon is given, keep the original path/name.
    if [[ "$mapping" == *:* ]]; then
        SOURCE_REL="${mapping%%:*}"
        TARGET_REL="${mapping#*:}"
    else
        SOURCE_REL="$mapping"
        TARGET_REL="$mapping"
    fi

    SOURCE="$REPO_ROOT/$SOURCE_REL"
    TARGET="$DEST/$TARGET_REL"

    if [[ ! -e "$SOURCE" ]]; then
        echo "Warning: not found: $SOURCE_REL" >&2
        continue
    fi

    # Ensure the target parent directory exists
    mkdir -p "$(dirname "$TARGET")"

    if [[ -d "$SOURCE" ]]; then
        # Copy directory contents into the target directory
        mkdir -p "$TARGET"
        cp -a "$SOURCE/." "$TARGET/"
    else
        cp -a "$SOURCE" "$TARGET"
    fi

    if [[ "$SOURCE_REL" == "$TARGET_REL" ]]; then
        echo "Copied: $SOURCE_REL"
    else
        echo "Copied: $SOURCE_REL -> $TARGET_REL"
    fi
done

echo
echo "Done."