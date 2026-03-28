import { z } from 'zod';
import { resolve } from 'path';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { getGeneratedDir } from '../../../utils/get-generated-dir';

export const describeCommandTool = defineTool({
    name: 'describe_command',
    description: 'Get the full argument schema for a command: path params, query params, body fields with types/required/descriptions. Use this to learn what args a command accepts.',
    schema: {
        command: z.string().describe('The command path, e.g. "todos create" or "admin users list"'),
    },
    handler: async (params, ctx) => {
        try {
            const mapPath = resolve(getGeneratedDir(ctx), 'command-map');
            const mapModule = await import(mapPath);
            const commandMap = mapModule.commandMap as Record<string, Record<string, unknown>>;
            const info = commandMap[params.command];
            if (!info) {
                const available = Object.keys(commandMap).join(', ');
                return textResult(
                    `Command "${params.command}" not found. Available commands: ${available}`,
                    true,
                );
            }
            return textResult(JSON.stringify(info, null, 2));
        } catch {
            return textResult(
                'Command map not available. Run generate first.\n'
                + `Looked in: ${getGeneratedDir(ctx)}/command-map.ts`,
                true,
            );
        }
    },
});
