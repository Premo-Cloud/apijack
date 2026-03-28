import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const configListTool = defineTool({
    name: 'config_list',
    description: 'List all configured environments.',
    schema: {},
    handler: async (_params, ctx) => {
        const { stdout, stderr, exitCode } = await runCli(
            ctx.cliInvocation,
            ['config', 'list'],
            ctx.projectRoot ?? undefined,
        );
        if (exitCode !== 0) {
            return textResult(
                `Config list failed (exit ${exitCode}):\n${stderr || stdout}`,
                true,
            );
        }
        return textResult(stdout);
    },
});
