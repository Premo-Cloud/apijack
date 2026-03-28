import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { getActiveEnvConfig } from '../../../../config';

export const getConfigTool = defineTool({
    name: 'get_config',
    description: 'Get the active environment configuration (password is stripped).',
    schema: {},
    handler: async (_params, ctx) => {
        const env = getActiveEnvConfig(
            ctx.cliName,
            ctx.configPath ? { configPath: ctx.configPath } : undefined,
        );
        if (!env) {
            return textResult('No active environment configured.', true);
        }
        // Strip password from output
        const { password: _password, ...safe } = env;
        return textResult(JSON.stringify(safe, null, 2));
    },
});
