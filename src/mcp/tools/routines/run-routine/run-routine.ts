import { z } from 'zod';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const runRoutineTool = defineTool({
    name: 'run_routine',
    description: 'Execute a named routine (workflow automation). Use list_routines to discover available routines.',
    schema: {
        name: z.string().describe('The routine name, e.g. "load/quick" or "setup/full"'),
        set: z.record(z.string(), z.string()).optional().describe('Optional variable overrides as key-value pairs'),
    },
    handler: async (params, ctx) => {
        const setArgs = Object.entries(params.set || {}).flatMap(([k, v]) => [
            '--set',
            `${k}=${v}`,
        ]);
        const { stdout, stderr, exitCode } = await runCli(ctx.cliInvocation, [
            'routine',
            'run',
            params.name,
            ...setArgs,
        ], ctx.projectRoot ?? undefined);
        if (exitCode !== 0) {
            return textResult(
                `Routine failed (exit ${exitCode}):\n${stderr || stdout}`,
                true,
            );
        }
        return textResult(stdout);
    },
});
