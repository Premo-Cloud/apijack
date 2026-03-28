import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { z } from 'zod';
import { defineTool } from '../../../types';
import { textResult } from '../../../utils/text-result';
import { runCli } from '../../../utils/run-cli';
import { saveEnvironment } from '../../../../config';
import { classifyUrl } from '../../../../url-classifier';

export const setupTool = defineTool({
    name: 'setup',
    description:
        'Configure API credentials for an environment and auto-generate the CLI. '
        + 'Only works for development URLs (localhost and configured CIDR ranges). '
        + 'For production APIs, use environment variables.',
    schema: {
        name: z.string().describe('Environment name, e.g. "dev" or "staging"'),
        url: z.string().describe('API base URL, e.g. "http://localhost:8080"'),
        user: z.string().describe('Username or email for authentication'),
        password: z.string().describe('Password for authentication'),
    },
    handler: async (params, ctx) => {
        const classification = classifyUrl(params.url, ctx.allowedCidrs);
        if (!classification.safe) {
            let hostname: string;
            try {
                hostname = new URL(params.url).hostname;
            } catch {
                hostname = params.url;
            }
            return textResult(
                `Production API detected (${hostname}).\n`
                + 'The MCP setup tool cannot store credentials for production APIs.\n\n'
                + 'Use environment variables instead:\n'
                + `  ${ctx.cliName.toUpperCase()}_URL=${params.url}\n`
                + `  ${ctx.cliName.toUpperCase()}_USER=${params.user}\n`
                + `  ${ctx.cliName.toUpperCase()}_PASS=<password>\n\n`
                + 'Or add this network to allowedCidrs in ~/.apijack/plugin.json',
                true,
            );
        }

        // Bootstrap project config if in a project directory without .apijack.json
        if (ctx.projectRoot) {
            const apijackJsonPath = join(ctx.projectRoot, '.apijack.json');
            if (!existsSync(apijackJsonPath)) {
                const hasPackageJson = existsSync(join(ctx.projectRoot, 'package.json'));
                const hasGit = existsSync(join(ctx.projectRoot, '.git'));
                if (hasPackageJson || hasGit) {
                    let specUrl = '/v3/api-docs';
                    try {
                        specUrl = new URL(params.url).pathname || '/v3/api-docs';
                        if (specUrl === '/') specUrl = '/v3/api-docs';
                    } catch {}
                    writeFileSync(apijackJsonPath, JSON.stringify({
                        specUrl,
                        generatedDir: '.apijack/generated',
                    }, null, 2) + '\n');

                    // Update config path to project-local now that .apijack.json exists
                    const projectConfigDir = join(ctx.projectRoot, '.apijack');
                    ctx.configPath = join(projectConfigDir, 'config.json');
                    ctx.routinesDir = join(projectConfigDir, 'routines');
                }
            }
        }

        // Ensure config dir exists
        if (ctx.configPath) {
            const configDir = dirname(ctx.configPath);
            mkdirSync(configDir, { recursive: true });
        }

        try {
            const configOpts: { configPath?: string; allowedCidrs?: string[] } = {
                allowedCidrs: ctx.allowedCidrs,
            };
            if (ctx.configPath) configOpts.configPath = ctx.configPath;
            await saveEnvironment(ctx.cliName, params.name, {
                url: params.url,
                user: params.user,
                password: params.password,
            }, true, configOpts);
        } catch (err) {
            return textResult(
                `Setup failed: ${err instanceof Error ? err.message : String(err)}`,
                true,
            );
        }

        // Auto-generate CLI after successful setup
        try {
            const { stdout: genOut, stderr: genErr, exitCode: genCode } = await runCli(
                ctx.cliInvocation, ['generate'], ctx.projectRoot ?? undefined,
            );
            if (genCode !== 0) {
                return textResult(
                    `Environment "${params.name}" configured (${params.url})\n`
                    + `Generate failed (exit ${genCode}):\n${genErr || genOut}`,
                    true,
                );
            }
            return textResult(
                `Environment "${params.name}" configured (${params.url})\n${genOut.trim()}`,
            );
        } catch {
            return textResult(
                `Environment "${params.name}" configured (${params.url})\n`
                + 'Generate could not run. Run generate manually.',
                true,
            );
        }
    },
});
