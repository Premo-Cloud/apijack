---
name: test-tutorial-agent
description: Run the tutorial agent experiment — starts the e2e Docker container, overwrites the plugin cache with dev builds, and spawns a subagent with the tutorial prompt to verify MCP tools and skills work end-to-end
---

# Test Tutorial Agent

Automated experiment to verify that the apijack MCP tools and write-routine skill work correctly by spawning a subagent that drives the full tutorial workflow.

## Steps

Run these steps in order:

### 1. Rebuild plugin cache with dev source

```bash
./scripts/dev-plugin.sh
```

### 2. Start the e2e Docker container (if not already running)

```bash
docker rm -f apijack-e2e 2>/dev/null
docker build -f tests/e2e-tutorial/Dockerfile -t apijack-e2e .
docker run --rm -d --name apijack-e2e -p 3456:3456 apijack-e2e sh -c "cd /tutorial && bun run src/server.ts"
```

Wait for the server to be ready:

```bash
until curl -sf http://localhost:3456/v3/api-docs > /dev/null 2>&1; do sleep 0.2; done
```

### 3. Ask the user to reload plugins

Tell the user: "Run `/reload-plugins` so the MCP server picks up the dev builds, then say 'go' to continue."

**STOP and wait for the user to confirm before proceeding.**

### 4. Spawn the tutorial subagent

Launch a subagent with this exact prompt:

> Use the /write-routine skill. Connect to the TODO API at http://localhost:3456 with username admin and password admin, then generate the CLI. From there, create 50 TODOs with creative titles. After all 50 are created, update each one in a random order to have a random background color. After all 50 have been colored, delete them all in reverse order.

### 5. Report results

After the subagent completes, report:
- Whether it succeeded or failed
- How many MCP tool calls it made
- Whether it used loops (`range`, `forEach`, `shuffle`, `reverse`) or hardcoded steps
- Read the routine YAML it created and assess if it's idiomatic

### 6. Clean up

```bash
docker stop apijack-e2e 2>/dev/null
rm -rf /home/garret/projects/apijack/.apijack
```

Then remind the user: "Run `./scripts/dev-plugin.sh --restore` and `/reload-plugins` when done testing."
