#!/usr/bin/env bash
set -e

# ==============================================================================
# NexCC — Startup Script
# Interactive Optimizing Compiler & Compiler Construction Workbench
# ==============================================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "======================================================================"
echo "  🚀 Starting NexCC: The Compiler Where Nothing is Hidden"
echo "  Academic Year 2026 - 2027 · Department of CSE"
echo "  Students: N. Rithvik Sai & Ch. Jitheswar"
echo "  Guide:    Dr. Krishna Kishore"
echo "======================================================================"
echo ""

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Error: Node.js is not installed or not in PATH."
  echo "   Please install Node.js v16 or higher."
  exit 1
fi

NODE_VERSION=$(node -v)
echo "✓ Found Node.js ($NODE_VERSION)"

# Run quick verification test if requested or first run
if [ "$1" == "--test" ]; then
  echo "🧪 Running test suite verification..."
  npm test
  echo ""
fi

# Launch NexCC main application and Web Workbench server
echo "⚡ Starting NexCC Engine & Interactive Web Workbench..."
exec node "$PROJECT_DIR/src/main.js"
