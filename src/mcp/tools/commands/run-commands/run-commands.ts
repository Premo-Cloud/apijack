import { z } from 'zod';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const runCommandsTool = defineTool({
    name: 'run_commands',
    description: 'Run one or more CLI commands sequentially. Path parameters go in the command string (e.g. "todos patch <id>"). Use args for flags (e.g. {"--title": "value"}). Prefer routines (create_routine + run_routine) for repeatable workflows.',
    schema: {
        commands: z.array(
            z.object({
                command: z.string().describe('The command path with any path params, e.g. "todos patch 123"'),
                args: z.record(z.string(), z.string()).optional().describe('Flag arguments, e.g. {"--title": "value"}'),
            }),
        ).describe('List of commands to run sequentially'),
        stop_on_error: z.boolean().optional().describe('Stop executing remaining commands if one fails'),
    },
    handler: async (params, ctx) => {
        const results: string[] = [];
        let failures = 0;
        let ran = 0;
        for (let i = 0; i < params.commands.length; i++) {
            ran++;
            const cmd = params.commands[i];
            const cmdParts = cmd.command.split(/\s+/);
            const flagArgs = Object.entries(cmd.args || {}).flatMap(([k, v]) => [
                k,
                String(v),
            ]);
            const { stdout, stderr, exitCode } = await runCli(ctx.cliInvocation, [
                ...cmdParts,
                ...flagArgs,
            ], ctx.projectRoot ?? undefined);
            if (exitCode !== 0) {
                failures++;
                results.push(`[${i + 1}/${params.commands.length}] FAIL: ${cmd.command}\n${stderr || stdout}`);
                if (params.stop_on_error) {
                    results.push(`Stopped after ${ran}/${params.commands.length} commands.`);
                    break;
                }
            } else {
                results.push(`[${i + 1}/${params.commands.length}] OK: ${cmd.command}${stdout ? '\n' + stdout.trim() : ''}`);
            }
        }
        const summary = `Ran ${ran}/${params.commands.length} commands (${failures} failed)`;
        return textResult(
            summary + '\n\n' + results.join('\n\n'),
            failures > 0,
        );
    },
});
