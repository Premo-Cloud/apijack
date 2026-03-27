import { readFileSync } from 'fs';
import { resolve } from 'path';
import { listRoutinesStructured } from './agent-docs/render';
import { getActiveEnvConfig } from './config';

export interface McpServerOptions {
    cliName: string;
    cliInvocation: string[]; // e.g. ["bun", "run", "src/cli.ts"] or ["/path/to/binary"]
    generatedDir: string;
    routinesDir: string;
}

// ── Tool definitions ────────────────────────────────────────────────

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

export function getToolDefinitions(): ToolDefinition[] {
    return [
        {
            name: 'run_command',
            description:
        'Run a CLI command by name with optional flag arguments. Use list_commands to discover available commands first.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description:
              'The CLI command path, e.g. "matters list" or "admin users create"',
                    },
                    args: {
                        type: 'object',
                        description:
              'Optional flag arguments as key-value pairs, e.g. {"--name": "test", "--active": "true"}',
                        additionalProperties: { type: 'string' },
                    },
                },
                required: ['command'],
            },
        },
        {
            name: 'run_routine',
            description:
        'Execute a named routine (workflow automation). Use list_routines to discover available routines.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The routine name, e.g. "load/quick" or "setup/full"',
                    },
                    set: {
                        type: 'object',
                        description:
              'Optional variable overrides as key-value pairs, e.g. {"matterId": "123", "path": "/data"}',
                        additionalProperties: { type: 'string' },
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'generate',
            description:
        "Regenerate CLI client code from the active environment's OpenAPI spec.",
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'config_switch',
            description: 'Switch the active environment configuration.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'The environment name to switch to',
                    },
                },
                required: ['name'],
            },
        },
        {
            name: 'config_list',
            description: 'List all configured environments.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'list_commands',
            description:
        'List available CLI commands. Optionally filter by a prefix to narrow results.',
            inputSchema: {
                type: 'object',
                properties: {
                    filter: {
                        type: 'string',
                        description:
              'Optional prefix to filter commands, e.g. "admin" or "matters"',
                    },
                },
            },
        },
        {
            name: 'list_routines',
            description: 'List all available routines for workflow automation.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'get_config',
            description:
        'Get the active environment configuration (password is stripped).',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
        {
            name: 'get_spec',
            description:
        'Get a summary of the generated API types including interface and type counts.',
            inputSchema: {
                type: 'object',
                properties: {},
            },
        },
    ];
}

// ── Helpers ─────────────────────────────────────────────────────────

interface ToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

function textResult(text: string, isError?: boolean): ToolResult {
    return {
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
    };
}

async function runCli(
    cliInvocation: string[],
    args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn([...cliInvocation, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
}

// ── Handlers ────────────────────────────────────────────────────────

export function createHandlers(opts: McpServerOptions) {
    return {
        run_command: async (input: {
            command: string;
            args?: Record<string, string>;
        }): Promise<ToolResult> => {
            const cmdParts = input.command.split(/\s+/);
            const flagArgs = Object.entries(input.args || {}).flatMap(([k, v]) => [
                k,
                String(v),
            ]);
            const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                ...cmdParts,
                ...flagArgs,
            ]);
            if (exitCode !== 0) {
                return textResult(
                    `Command failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        run_routine: async (input: {
            name: string;
            set?: Record<string, string>;
        }): Promise<ToolResult> => {
            const setArgs = Object.entries(input.set || {}).flatMap(([k, v]) => [
                '--set',
                `${k}=${v}`,
            ]);
            const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                'routine',
                'run',
                input.name,
                ...setArgs,
            ]);
            if (exitCode !== 0) {
                return textResult(
                    `Routine failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        generate: async (): Promise<ToolResult> => {
            const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                'generate',
                '--skip-agent-docs',
            ]);
            if (exitCode !== 0) {
                return textResult(
                    `Generate failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        config_switch: async (input: { name: string }): Promise<ToolResult> => {
            const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                'config',
                'switch',
                input.name,
            ]);
            if (exitCode !== 0) {
                return textResult(
                    `Config switch failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        config_list: async (): Promise<ToolResult> => {
            const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                'config',
                'list',
            ]);
            if (exitCode !== 0) {
                return textResult(
                    `Config list failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        list_commands: async (input: {
            filter?: string;
        }): Promise<ToolResult> => {
            try {
                const mapPath = resolve(opts.generatedDir, 'command-map');
                const mapModule = await import(mapPath);
                const commandMap: Record<
                    string,
                    {
                        operationId: string;
                        pathParams: string[];
                        queryParams: string[];
                        hasBody: boolean;
                        description?: string;
                    }
                > = mapModule.commandMap;

                let entries = Object.entries(commandMap);
                if (input.filter) {
                    const prefix = input.filter.toLowerCase();
                    entries = entries.filter(([path]) =>
                        path.toLowerCase().startsWith(prefix),
                    );
                }

                if (entries.length === 0) {
                    return textResult(
                        input.filter
                            ? `No commands found matching "${input.filter}".`
                            : 'No commands available. Run generate first.',
                    );
                }

                const lines = entries.map(([path, info]) => {
                    const parts = [path];
                    if (info.description) parts.push(`- ${info.description}`);
                    if (info.pathParams.length > 0)
                        parts.push(`[path: ${info.pathParams.join(', ')}]`);
                    if (info.queryParams.length > 0)
                        parts.push(`[query: ${info.queryParams.join(', ')}]`);
                    if (info.hasBody) parts.push('[has body]');
                    return parts.join('  ');
                });

                return textResult(lines.join('\n'));
            } catch {
                return textResult(
                    'Command map not available. Run generate first.',
                    true,
                );
            }
        },

        list_routines: async (): Promise<ToolResult> => {
            const routines = listRoutinesStructured(opts.routinesDir);
            if (routines.length === 0) {
                return textResult('No routines found.');
            }
            const lines = routines.map(r => r.name);
            return textResult(lines.join('\n'));
        },

        get_config: async (): Promise<ToolResult> => {
            const env = getActiveEnvConfig(opts.cliName);
            if (!env) {
                return textResult('No active environment configured.', true);
            }
            // Strip password from output
            const { password: _password, ...safe } = env;
            return textResult(JSON.stringify(safe, null, 2));
        },

        get_spec: async (): Promise<ToolResult> => {
            try {
                const typesPath = resolve(opts.generatedDir, 'types.ts');
                const content = readFileSync(typesPath, 'utf-8');

                const interfaceMatches = content.match(/^export interface /gm);
                const typeMatches = content.match(/^export type /gm);
                const interfaceCount = interfaceMatches ? interfaceMatches.length : 0;
                const typeCount = typeMatches ? typeMatches.length : 0;

                return textResult(
                    JSON.stringify(
                        {
                            file: typesPath,
                            interfaces: interfaceCount,
                            types: typeCount,
                            totalLines: content.split('\n').length,
                        },
                        null,
                        2,
                    ),
                );
            } catch {
                return textResult(
                    'Types file not available. Run generate first.',
                    true,
                );
            }
        },
    };
}

// ── Server startup ──────────────────────────────────────────────────

export async function startMcpServer(opts: McpServerOptions): Promise<void> {
    // Dynamic import -- fails gracefully if SDK not installed
    const { McpServer } = await import(
        '@modelcontextprotocol/sdk/server/mcp.js',
    );
    const { StdioServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/stdio.js',
    );

    const server = new McpServer({
        name: `${opts.cliName}-mcp`,
        version: '1.0.0',
    });

    const handlers = createHandlers(opts);
    const tools = getToolDefinitions();

    // Register each tool
    for (const tool of tools) {
        const handler = handlers[tool.name as keyof typeof handlers];
        server.tool(
            tool.name,
            tool.description,
            tool.inputSchema.properties,
            async (input: Record<string, unknown>) => {
                const result = await (handler as (input: any) => Promise<ToolResult>)(
                    input,
                );
                return result;
            },
        );
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
}
