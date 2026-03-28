import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';

export const createRoutineTool = defineTool({
    name: 'create_routine',
    description: 'Create or overwrite a routine YAML file. The routine can then be run with run_routine.',
    schema: {
        name: z.string().describe('Routine name (used as filename, e.g. "create-todos" → create-todos.yaml)'),
        content: z.string().describe('The full YAML content for the routine'),
    },
    handler: async (params, ctx) => {
        try {
            mkdirSync(ctx.routinesDir, { recursive: true });
            const filename = params.name.endsWith('.yaml') ? params.name : `${params.name}.yaml`;
            const filePath = join(ctx.routinesDir, filename);
            writeFileSync(filePath, params.content);
            return textResult(`Routine saved to ${filePath}`);
        } catch (err) {
            return textResult(
                `Failed to create routine: ${err instanceof Error ? err.message : String(err)}`,
                true,
            );
        }
    },
});
