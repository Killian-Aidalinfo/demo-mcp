# Serveur MCP France Travail — transport HTTP (Streamable HTTP)
# Image prête pour Coolify (build pack « Dockerfile »).
#
# Build :  docker build -t mcp-france-travail .
# Run   :  docker run -p 3000:3000 \
#            -e FT_CLIENT_ID=... -e FT_CLIENT_SECRET=... mcp-france-travail
#
# Endpoints : POST /mcp (JSON-RPC)  •  GET /health
FROM oven/bun:1.2-slim AS base
WORKDIR /app

# curl : requis par le health check Coolify (déploiement Dockerfile) — l'image bun-slim ne l'a pas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# --- Dépendances (couche cachée tant que package.json ne change pas) ---
COPY mcp/package.json ./mcp/
RUN cd mcp && bun install

# --- Code source ---
COPY mcp ./mcp

# --- Runtime ---
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=3000 \
    MCP_PATH=/mcp
EXPOSE 3000

# FT_CLIENT_ID / FT_CLIENT_SECRET à fournir via les variables d'env Coolify.

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-3000}/health" || exit 1

USER bun
CMD ["bun", "mcp/index.ts"]
