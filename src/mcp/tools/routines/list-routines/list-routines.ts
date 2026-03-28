import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { listRoutinesStructured } from '../../../../routine/loader';

export const listRoutinesTool = defineTool({
    name: 'list_routines',
    description: 'List all available routines for workflow automation.',
    schema: {},
    handler: async (_params, ctx) => {
        const routines = listRoutinesStructured(ctx.routinesDir);
        if (routines.length === 0) {
            return textResult(
                `No routines found in ${ctx.routinesDir}/.\n`
                + 'Create a routine with the create_routine tool or place a YAML file in that directory.',
            );
        }
        const lines = routines.map(r => r.name);
        return textResult(lines.join('\n'));
    },
});
