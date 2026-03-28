import { z } from 'zod';
import { resolve } from 'path';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { getGeneratedDir } from '../../../utils/get-generated-dir';

export const listCommandsTool = defineTool({
    name: 'list_commands',
    description: 'List available CLI commands. Optionally filter by a prefix to narrow results.',
    schema: {
        filter: z.string().optional().describe('Optional prefix to filter commands, e.g. "admin" or "todos"'),
    },
    handler: async (params, ctx) => {
        try {
            const mapPath = resolve(getGeneratedDir(ctx), 'command-map');
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
            if (params.filter) {
                const prefix = params.filter.toLowerCase();
                entries = entries.filter(([path]) =>
                    path.toLowerCase().startsWith(prefix),
                );
            }

            if (entries.length === 0) {
                return textResult(
                    params.filter
                        ? `No commands found matching "${params.filter}".`
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
                + `Looked in: ${getGeneratedDir(ctx)}/command-map.ts`,
                true,
            );
        }
    },
});
