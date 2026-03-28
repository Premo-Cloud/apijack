import { z } from 'zod';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { getGeneratedDir } from '../../../utils/get-generated-dir';

export const getSpecTool = defineTool({
    name: 'get_spec',
    description: 'Get generated API type definitions. Default: lists type names. With verbose=true: full TypeScript interface definitions with all fields.',
    schema: {
        verbose: z.boolean().optional().describe('Return full type definitions instead of just type names'),
    },
    handler: async (params, ctx) => {
        try {
            const typesPath = resolve(getGeneratedDir(ctx), 'types.ts');
            const content = readFileSync(typesPath, 'utf-8');

            if (params.verbose) {
                return textResult(content);
            }

            // Default: return a compact summary with type names
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
                + 'or describe_command to see a specific command\'s argument schema.',
            );
        } catch {
            return textResult(
                'Types file not available. Run generate first.\n'
                + `Looked in: ${getGeneratedDir(ctx)}/types.ts`,
                true,
            );
        }
    },
});
