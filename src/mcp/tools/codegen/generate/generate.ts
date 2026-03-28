import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';

export const generateTool = defineTool({
    name: 'generate',
    description: "Regenerate CLI client code from the active environment's OpenAPI spec.",
    schema: {},
    handler: async (_params, ctx) => {
        const { stdout, stderr, exitCode } = await runCli(
            ctx.cliInvocation,
            ['generate'],
            ctx.projectRoot ?? undefined,
        );
        if (exitCode !== 0) {
            return textResult(
                `Generate failed (exit ${exitCode}):\n${stderr || stdout}`,
                true,
            );
        }
        return textResult(stdout);
    },
});
