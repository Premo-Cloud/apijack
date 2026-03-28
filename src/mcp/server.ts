import type { McpContext } from './types';

import { listCommandsTool } from './tools/commands/list-commands/list-commands';
import { describeCommandTool } from './tools/commands/describe-command/describe-command';
import { runCommandsTool } from './tools/commands/run-commands/run-commands';
import { listRoutinesTool } from './tools/routines/list-routines/list-routines';
import { createRoutineTool } from './tools/routines/create-routine/create-routine';
import { runRoutineTool } from './tools/routines/run-routine/run-routine';
import { getRoutineTemplatesTool } from './tools/routines/get-routine-templates/get-routine-templates';
import { configListTool } from './tools/config/config-list/config-list';
import { configSwitchTool } from './tools/config/config-switch/config-switch';
import { getConfigTool } from './tools/config/get-config/get-config';
import { setupTool } from './tools/config/setup/setup';
import { generateTool } from './tools/codegen/generate/generate';
import { getSpecTool } from './tools/codegen/get-spec/get-spec';

const allTools = [
    listCommandsTool,
    describeCommandTool,
    runCommandsTool,
    listRoutinesTool,
    createRoutineTool,
    runRoutineTool,
    getRoutineTemplatesTool,
    configListTool,
    configSwitchTool,
    getConfigTool,
    setupTool,
    generateTool,
    getSpecTool,
];

export async function startMcpServer(opts: McpContext): Promise<void> {
    const { McpServer } = await import(
        '@modelcontextprotocol/sdk/server/mcp.js',
    );
    const { StdioServerTransport } = await import(
        '@modelcontextprotocol/sdk/server/stdio.js',
    );

    const server = new McpServer(
        { name: `${opts.cliName}-mcp`, version: '1.0.0' },
    );

    for (const tool of allTools) {
        server.registerTool(tool.name, {
            description: tool.description,
            inputSchema: tool.schema,
        }, (params: Record<string, unknown>) => tool.handler(params as any, opts));
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
}
