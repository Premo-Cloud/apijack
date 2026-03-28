import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { listRoutinesStructured } from './routine/loader';
import { getActiveEnvConfig, saveEnvironment } from './config';
import { classifyUrl } from './url-classifier';
import { findProjectConfig, loadProjectConfig } from './project';

export interface McpServerOptions {
    cliName: string;
    cliInvocation: string[]; // e.g. ["bun", "run", "src/cli.ts"] or ["/path/to/binary"]
    generatedDir: string;
    routinesDir: string;
    projectRoot?: string;
    configPath?: string;
    allowedCidrs?: string[];
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
              'The CLI command path, e.g. "todos list" or "admin users create"',
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
            name: 'run_commands',
            description:
        'Run multiple CLI commands sequentially in a single call. Each command runs after the previous one completes. '
        + 'Use this for batch operations like creating many resources. Returns all results.',
            inputSchema: {
                type: 'object',
                properties: {
                    commands: {
                        type: 'array',
                        description: 'Array of commands to run sequentially',
                        items: {
                            type: 'object',
                            properties: {
                                command: {
                                    type: 'string',
                                    description: 'The CLI command path',
                                },
                                args: {
                                    type: 'object',
                                    description: 'Optional flag arguments as key-value pairs',
                                    additionalProperties: { type: 'string' },
                                },
                            },
                            required: ['command'],
                        },
                    },
                },
                required: ['commands'],
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
              'Optional prefix to filter commands, e.g. "admin" or "todos"',
                    },
                },
            },
        },
        {
            name: 'describe_command',
            description:
        'Get the full argument schema for a specific command, including path params, query params, '
        + 'and request body fields with types and descriptions.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'The command path, e.g. "todos create" or "admin users list"',
                    },
                },
                required: ['command'],
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
            name: 'create_routine',
            description:
        'Create or overwrite a routine YAML file. The routine can then be run with run_routine.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Routine name (used as filename, e.g. "create-todos" → create-todos.yaml)',
                    },
                    content: {
                        type: 'string',
                        description: 'The full YAML content for the routine',
                    },
                },
                required: ['name', 'content'],
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
        'Get API type information. Without args: lists type names. With verbose=true: full type definitions. '
        + 'With command="<name>": shows that command\'s argument signature as a routine step template.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'Show the argument signature for a specific command, e.g. "todos create"',
                    },
                    verbose: {
                        type: 'boolean',
                        description: 'Return full type definitions instead of just type names',
                    },
                },
            },
        },
        {
            name: 'setup',
            description:
        'Configure API credentials for an environment. Only works for development URLs '
        + '(localhost, .local, .dev, .test, .staging, and configured CIDR ranges). '
        + 'For production APIs, use environment variables.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: {
                        type: 'string',
                        description: 'Environment name, e.g. "dev" or "staging"',
                    },
                    url: {
                        type: 'string',
                        description: 'API base URL, e.g. "http://localhost:8080"',
                    },
                    user: {
                        type: 'string',
                        description: 'Username or email for authentication',
                    },
                    password: {
                        type: 'string',
                        description: 'Password for authentication',
                    },
                },
                required: ['name', 'url', 'user', 'password'],
            },
        },
    ];
}

// ── Helpers ─────────────────────────────────────────────────────────

interface ToolResult {
    [key: string]: unknown;
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
    cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn([...cliInvocation, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        ...(cwd ? { cwd } : {}),
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
}

// ── Handlers ────────────────────────────────────────────────────────

export function createHandlers(opts: McpServerOptions) {
    // Lazily resolve generatedDir based on current project state.
    // This handles the case where setup+generate create .apijack.json and
    // generated files after the MCP server has already started.
    function getGeneratedDir(): string {
        if (opts.projectRoot) {
            const projectConfigPath = findProjectConfig(opts.projectRoot);
            if (projectConfigPath) {
                const projectConfig = loadProjectConfig(projectConfigPath);
                const projectRoot = dirname(projectConfigPath);
                if (projectConfig?.generatedDir) {
                    return resolve(projectRoot, projectConfig.generatedDir);
                }
                return resolve(projectRoot, '.apijack', 'generated');
            }
        }
        return opts.generatedDir;
    }

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
            ], opts.projectRoot ?? undefined);
            if (exitCode !== 0) {
                return textResult(
                    `Command failed (exit ${exitCode}):\n${stderr || stdout}`,
                    true,
                );
            }
            return textResult(stdout);
        },

        run_commands: async (input: {
            commands: Array<{ command: string; args?: Record<string, string> }>;
        }): Promise<ToolResult> => {
            const results: string[] = [];
            let failures = 0;
            for (let i = 0; i < input.commands.length; i++) {
                const cmd = input.commands[i];
                const cmdParts = cmd.command.split(/\s+/);
                const flagArgs = Object.entries(cmd.args || {}).flatMap(([k, v]) => [
                    k,
                    String(v),
                ]);
                const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                    ...cmdParts,
                    ...flagArgs,
                ], opts.projectRoot ?? undefined);
                if (exitCode !== 0) {
                    failures++;
                    results.push(`[${i + 1}/${input.commands.length}] FAIL: ${cmd.command}\n${stderr || stdout}`);
                } else {
                    results.push(`[${i + 1}/${input.commands.length}] OK: ${cmd.command}${stdout ? '\n' + stdout.trim() : ''}`);
                }
            }
            const summary = `Completed ${input.commands.length} commands (${failures} failed)`;
            return textResult(
                summary + '\n\n' + results.join('\n\n'),
                failures > 0,
            );
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
            ], opts.projectRoot ?? undefined);
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
            ], opts.projectRoot ?? undefined);
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
            ], opts.projectRoot ?? undefined);
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
            ], opts.projectRoot ?? undefined);
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
                const mapPath = resolve(getGeneratedDir(), 'command-map');
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
                    'Command map not available. Run generate first.\n'
                    + `Looked in: ${getGeneratedDir()}/command-map.ts`,
                    true,
                );
            }
        },

        describe_command: async (input: {
            command: string;
        }): Promise<ToolResult> => {
            try {
                const mapPath = resolve(getGeneratedDir(), 'command-map');
                const mapModule = await import(mapPath);
                const commandMap = mapModule.commandMap as Record<string, Record<string, unknown>>;
                const info = commandMap[input.command];
                if (!info) {
                    const available = Object.keys(commandMap).join(', ');
                    return textResult(
                        `Command "${input.command}" not found. Available commands: ${available}`,
                        true,
                    );
                }
                return textResult(JSON.stringify(info, null, 2));
            } catch {
                return textResult(
                    'Command map not available. Run generate first.\n'
                    + `Looked in: ${getGeneratedDir()}/command-map.ts`,
                    true,
                );
            }
        },

        list_routines: async (): Promise<ToolResult> => {
            const routines = listRoutinesStructured(opts.routinesDir);
            if (routines.length === 0) {
                return textResult(
                    `No routines found in ${opts.routinesDir}/.\n`
                    + 'Create a routine with the create_routine tool or place a YAML file in that directory.',
                );
            }
            const lines = routines.map(r => r.name);
            return textResult(lines.join('\n'));
        },

        create_routine: async (input: {
            name: string;
            content: string;
        }): Promise<ToolResult> => {
            try {
                mkdirSync(opts.routinesDir, { recursive: true });
                const filename = input.name.endsWith('.yaml') ? input.name : `${input.name}.yaml`;
                const filePath = join(opts.routinesDir, filename);
                writeFileSync(filePath, input.content);
                return textResult(`Routine saved to ${filePath}`);
            } catch (err) {
                return textResult(
                    `Failed to create routine: ${err instanceof Error ? err.message : String(err)}`,
                    true,
                );
            }
        },

        get_config: async (): Promise<ToolResult> => {
            const env = getActiveEnvConfig(opts.cliName, opts.configPath ? { configPath: opts.configPath } : undefined);
            if (!env) {
                return textResult('No active environment configured.', true);
            }
            // Strip password from output
            const { password: _password, ...safe } = env;
            return textResult(JSON.stringify(safe, null, 2));
        },

        get_spec: async (input: {
            command?: string;
            verbose?: boolean;
        }): Promise<ToolResult> => {
            // If a command is specified, run it with -o routine-step to show its signature
            if (input.command) {
                const cmdParts = input.command.split(/\s+/);
                const { stdout, stderr, exitCode } = await runCli(opts.cliInvocation, [
                    ...cmdParts,
                    '-o', 'routine-step',
                ], opts.projectRoot ?? undefined);
                if (exitCode !== 0) {
                    return textResult(
                        `Failed to describe "${input.command}":\n${stderr || stdout}`,
                        true,
                    );
                }
                return textResult(stdout);
            }

            try {
                const typesPath = resolve(getGeneratedDir(), 'types.ts');
                const content = readFileSync(typesPath, 'utf-8');

                if (input.verbose) {
                    return textResult(content);
                }

                // Default: return a compact summary with type names and their fields
                const blocks: string[] = [];
                const typeRegex = /^export (?:interface|type) (\w+)/gm;
                let match;
                while ((match = typeRegex.exec(content)) !== null) {
                    blocks.push(match[1]);
                }

                return textResult(
                    `Types defined in ${typesPath}:\n`
                    + blocks.join(', ')
                    + '\n\nUse get_spec with verbose=true to see full definitions, '
                    + 'or get_spec with command="<command>" to see a specific command\'s signature.',
                );
            } catch {
                return textResult(
                    'Types file not available. Run generate first.\n'
                    + `Looked in: ${getGeneratedDir()}/types.ts`,
                    true,
                );
            }
        },

        setup: async (input: {
            name: string;
            url: string;
            user: string;
            password: string;
        }): Promise<ToolResult> => {
            const classification = classifyUrl(input.url, opts.allowedCidrs);
            if (!classification.safe) {
                let hostname: string;
                try {
                    hostname = new URL(input.url).hostname;
                } catch {
                    hostname = input.url;
                }
                return textResult(
                    `Production API detected (${hostname}).\n`
                    + 'The MCP setup tool cannot store credentials for production APIs.\n\n'
                    + 'Use environment variables instead:\n'
                    + `  ${opts.cliName.toUpperCase()}_URL=${input.url}\n`
                    + `  ${opts.cliName.toUpperCase()}_USER=${input.user}\n`
                    + `  ${opts.cliName.toUpperCase()}_PASS=<password>\n\n`
                    + 'Or add this network to allowedCidrs in ~/.apijack/plugin.json',
                    true,
                );
            }

            // Bootstrap project config if in a project directory without .apijack.json
            if (opts.projectRoot) {
                const apijackJsonPath = join(opts.projectRoot, '.apijack.json');
                if (!existsSync(apijackJsonPath)) {
                    const hasPackageJson = existsSync(join(opts.projectRoot, 'package.json'));
                    const hasGit = existsSync(join(opts.projectRoot, '.git'));
                    if (hasPackageJson || hasGit) {
                        let specUrl = '/v3/api-docs';
                        try {
                            specUrl = new URL(input.url).pathname || '/v3/api-docs';
                            if (specUrl === '/') specUrl = '/v3/api-docs';
                        } catch {}
                        writeFileSync(apijackJsonPath, JSON.stringify({
                            specUrl,
                            generatedDir: '.apijack/generated',
                        }, null, 2) + '\n');
                    }
                }
            }

            // Ensure config dir exists
            if (opts.configPath) {
                const configDir = dirname(opts.configPath);
                mkdirSync(configDir, { recursive: true });
            }

            try {
                const configOpts: { configPath?: string; allowedCidrs?: string[] } = {
                    allowedCidrs: opts.allowedCidrs,
                };
                if (opts.configPath) configOpts.configPath = opts.configPath;
                await saveEnvironment(opts.cliName, input.name, {
                    url: input.url,
                    user: input.user,
                    password: input.password,
                }, true, configOpts);
                return textResult(`Environment "${input.name}" configured (${input.url})`);
            } catch (err) {
                return textResult(
                    `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
                    true,
                );
            }
        },
    };
}

// ── Server startup ──────────────────────────────────────────────────

export async function startMcpServer(opts: McpServerOptions): Promise<void> {
    // Use the low-level Server API with SDK request schemas — avoids Zod compat issues
    const { Server } = await import(
        '@modelcontextprotocol/sdk/server/index.js',
    );
    const { StdioServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/stdio.js',
    );
    const types = await import('@modelcontextprotocol/sdk/types.js');

    type CallToolRequest = typeof types.CallToolRequestSchema extends { _zod: { output: infer O } } ? O : never;
    type ToolHandler = (input: Record<string, string>) => Promise<ToolResult>;

    const server = new Server(
        { name: `${opts.cliName}-mcp`, version: '1.0.0' },
        { capabilities: { tools: { listChanged: true } } },
    );

    const handlers = createHandlers(opts);
    const tools = getToolDefinitions();

    server.setRequestHandler(
        types.ListToolsRequestSchema,
        async () => ({
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            })),
        }),
    );

    server.setRequestHandler(
        types.CallToolRequestSchema,
        async (request: CallToolRequest) => {
            const { name } = request.params;
            const args = request.params.arguments ?? {};
            const handler = handlers[name as keyof typeof handlers] as ToolHandler | undefined;
            if (!handler) {
                return {
                    content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
                    isError: true,
                };
            }
            return handler(args as Record<string, string>);
        },
    );

    const transport = new StdioServerTransport();
    await server.connect(transport);
}
