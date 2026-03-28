import { z } from 'zod';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const configSwitchTool = defineTool({
    name: 'config_switch',
    description: 'Switch the active environment configuration.',
    schema: {
        name: z.string().describe('The environment name to switch to'),
    },
    handler: async (params, ctx) => {
        const { stdout, stderr, exitCode } = await runCli(
            ctx.cliInvocation,
            ['config', 'switch', params.name],
            ctx.projectRoot ?? undefined,
        );
        if (exitCode !== 0) {
            return textResult(
                `Config switch failed (exit ${exitCode}):\n${stderr || stdout}`,
                true,
            );
        }
        return textResult(stdout);
    },
});
