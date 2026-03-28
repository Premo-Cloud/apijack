import { z } from 'zod';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const getRoutineTemplatesTool = defineTool({
    name: 'get_routine_templates',
    description: 'Get YAML routine step templates for multiple commands at once. Returns each command as a routine step with provided args and available options as comments. Use this to discover command signatures when building routines.',
    schema: {
        commands: z.array(
            z.object({
                command: z.string().describe('Command path, e.g. "todos create"'),
                args: z.record(z.string(), z.string()).optional().describe('Optional example args to include in template'),
            }),
        ).describe('Commands to get templates for'),
    },
    handler: async (params, ctx) => {
        const templates: string[] = [];
        for (const cmd of params.commands) {
            const cmdParts = cmd.command.split(/\s+/);
            const flagArgs = Object.entries(cmd.args || {}).flatMap(([k, v]) => [
                k,
                String(v),
            ]);
            const { stdout, stderr, exitCode } = await runCli(ctx.cliInvocation, [
                ...cmdParts,
                ...flagArgs,
                '-o', 'routine-step',
            ], ctx.projectRoot ?? undefined);
            if (exitCode !== 0) {
                templates.push(`# Error getting template for: ${cmd.command}\n# ${(stderr || stdout).trim()}`);
            } else {
                templates.push(stdout.trim());
            }
        }
        return textResult(templates.join('\n\n'));
    },
});
