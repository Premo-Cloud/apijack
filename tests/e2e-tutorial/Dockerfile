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

# ── Tutorial app ────────────────────────────────────────────────────
COPY tests/e2e-tutorial/tutorial-app/ /tutorial/
WORKDIR /tutorial
RUN bun install

# ── Routine ─────────────────────────────────────────────────────────
COPY tests/e2e-tutorial/tutorial-e2e.yaml /tutorial/.apijack/routines/tutorial-e2e.yaml

# ── Run ─────────────────────────────────────────────────────────────
ENV APIJACK_NO_UPDATE_CHECK=1
CMD ["sh", "-c", "\
  bun run src/server.ts & \
  echo 'Waiting for TODO server...' && \
  until curl -sf http://localhost:3456/v3/api-docs > /dev/null 2>&1; do sleep 0.2; done && \
  echo 'TODO server ready.' && \
  echo '=== Step 1: Generate CLI ===' && \
  bun run /apijack/bin/apijack.ts generate && \
  echo '=== Step 2: Run tutorial routine ===' && \
  bun run /apijack/bin/apijack.ts routine run tutorial-e2e && \
  echo '=== E2E Tutorial Test PASSED ===' \
"]
