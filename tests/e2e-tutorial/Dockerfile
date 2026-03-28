FROM oven/bun:latest

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# ── apijack source ──────────────────────────────────────────────────
COPY src/ /apijack/src/
COPY bin/ /apijack/bin/
COPY scripts/ /apijack/scripts/
COPY package.json bun.lock /apijack/
WORKDIR /apijack
RUN bun install
RUN bun run scripts/build-plugin.ts

# ── Plugin config ───────────────────────────────────────────────────
# The MCP server entry reads this to know how to invoke the CLI
RUN mkdir -p /root/.apijack && echo '{"cliInvocation":["bun","run","/apijack/bin/apijack.ts"]}' > /root/.apijack/plugin.json

# ── Tutorial app ────────────────────────────────────────────────────
COPY tests/e2e-tutorial/tutorial-app/ /tutorial/
WORKDIR /tutorial
RUN bun install

# ── Test runner ─────────────────────────────────────────────────────
COPY tests/e2e-tutorial/test.ts /test/test.ts
WORKDIR /test
RUN bun add @modelcontextprotocol/sdk

# ── Run ─────────────────────────────────────────────────────────────
CMD ["sh", "-c", "\
  cd /tutorial && bun run src/server.ts & \
  echo 'Waiting for TODO server...' && \
  until curl -sf http://localhost:3456/v3/api-docs > /dev/null 2>&1; do sleep 0.2; done && \
  echo 'TODO server ready.' && \
  cd /test && bun run test.ts \
"]
