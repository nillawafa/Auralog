#!/bin/bash
# AuraLog Quick Install for Umbrel
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${GREEN}"
echo "  ╔═══════════════════════════════╗"
echo "  ║   AuraLog Umbrel Installer    ║"
echo "  ╚═══════════════════════════════╝"
echo -e "${NC}"

INSTALL_DIR="${HOME}/umbrel/app-data/auralog"

if [ ! -d "${HOME}/umbrel" ]; then
  echo -e "${RED}Error: Umbrel not found at ~/umbrel${NC}"
  exit 1
fi

echo -e "${YELLOW}Installing to: ${INSTALL_DIR}${NC}"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone
if [ -d ".git" ]; then
  echo "Updating existing installation..."
  git pull
else
  echo "Cloning AuraLog..."
  git clone https://github.com/nillawafa/auralog.git .
fi

# Build
echo -e "${YELLOW}Building Docker image (this takes ~2-4 minutes)...${NC}"
docker-compose build --no-cache

# Start
echo "Starting AuraLog..."
docker-compose up -d

# Wait for health
sleep 3
if docker ps | grep -q auralog; then
  UMBREL_IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo -e "${GREEN}✓ AuraLog is running!${NC}"
  echo ""
  echo "  Access at: http://umbrel.local:3850"
  echo "  Or:        http://${UMBREL_IP}:3850"
  echo ""
  echo "  To stop:   docker-compose -f ${INSTALL_DIR}/docker-compose.yml down"
  echo "  To update: cd ${INSTALL_DIR} && git pull && docker-compose up -d --build"
else
  echo -e "${RED}Container failed to start. Check logs: docker logs auralog${NC}"
  exit 1
fi
