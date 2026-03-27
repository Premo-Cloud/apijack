import { Command } from 'commander';
import { resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { installPlugin } from './install';
import { uninstallPlugin } from './uninstall';
import { getPluginPaths } from './paths';

export function registerPluginCommand(
    program: Command,
    _cliName: string,
    version: string,
): void {
    const plugin = program
        .command('plugin')
        .description('Manage Claude Code plugin registration');

    plugin
        .command('install')
        .description('Register as a Claude Code plugin')
        .option('--cli-invocation <args...>', 'How to invoke this CLI (e.g., bun run src/cli.ts)')
        .option('--generated-dir <dir>', 'Path to generated files directory', 'src/generated')
        .action(async (opts: { cliInvocation?: string[]; generatedDir?: string }) => {
            const paths = getPluginPaths(version);

            const cliInvocation = opts.cliInvocation ?? process.argv.slice(0, 2);

            // Build the bundle if it doesn't exist
            const bundlePath = resolve(paths.sourceDir, 'dist', 'mcp-server.bundle.js');
            if (!existsSync(bundlePath)) {
                console.log('Building MCP server bundle...');
                const buildScript = resolve(paths.sourceDir, 'scripts', 'build-plugin.ts');
                const proc = Bun.spawn(['bun', 'run', buildScript], {
                    stdout: 'inherit',
                    stderr: 'inherit',
                });
                const exitCode = await proc.exited;
                if (exitCode !== 0) {
                    console.error('Bundle build failed.');
                    process.exit(1);
                }
            }

            const result = await installPlugin({
                version,
                claudeDir: paths.claudeDir,
                userDataDir: paths.userDataDir,
                sourceDir: paths.sourceDir,
                cliInvocation,
                generatedDir: opts.generatedDir ?? 'src/generated',
            });

            if (result.success) {
                console.log(result.message);
                console.log(`\n  Plugin cache:  ${result.pluginCacheDir}`);
                console.log(`  User data:     ${paths.userDataDir}`);
                console.log(`  CLI invocation: ${cliInvocation.join(' ')}`);
                console.log('\n── Next steps ──────────────────────────────────────');
                console.log('1. In Claude Code, run:  /reload-plugins');
                console.log('2. Then try a prompt like:');
                console.log('');
                console.log('   "Use /setup-api to connect apijack to my API at');
                console.log('    http://localhost:8080, then use /write-routine');
                console.log('    to automate my workflow."');
                console.log('');
            }
        });

    plugin
        .command('uninstall')
        .description('Remove Claude Code plugin registration')
        .action(async () => {
            const paths = getPluginPaths(version);
            const result = await uninstallPlugin({ claudeDir: paths.claudeDir });
            console.log(result.message);
        });

    const configCmd = plugin
        .command('config')
        .description('Manage plugin configuration');

    configCmd
        .command('add-cidr <cidr>')
        .description('Add a CIDR range to the allowed list (e.g., 192.168.1.0/24)')
        .action((cidr: string) => {
            const paths = getPluginPaths(version);
            const configPath = join(paths.userDataDir, 'plugin.json');

            let config: Record<string, unknown> = {};
            if (existsSync(configPath)) {
                try {
                    config = JSON.parse(readFileSync(configPath, 'utf-8'));
                } catch {}
            }

            const cidrs: string[] = (config.allowedCidrs as string[]) || [];
            if (cidrs.includes(cidr)) {
                console.log(`CIDR ${cidr} is already in the allowlist.`);
                return;
            }
            cidrs.push(cidr);
            config.allowedCidrs = cidrs;
            writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
            console.log(`Added ${cidr} to allowed CIDRs.`);
        });

    configCmd
        .command('remove-cidr <cidr>')
        .description('Remove a CIDR range from the allowed list')
        .action((cidr: string) => {
            const paths = getPluginPaths(version);
            const configPath = join(paths.userDataDir, 'plugin.json');

            if (!existsSync(configPath)) {
                console.error('No plugin config found.');
                return;
            }

            let config: Record<string, unknown> = {};
            try {
                config = JSON.parse(readFileSync(configPath, 'utf-8'));
            } catch {}

            const cidrs: string[] = (config.allowedCidrs as string[]) || [];
            const idx = cidrs.indexOf(cidr);
            if (idx === -1) {
                console.log(`CIDR ${cidr} is not in the allowlist.`);
                return;
            }
            cidrs.splice(idx, 1);
            config.allowedCidrs = cidrs;
            writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
            console.log(`Removed ${cidr} from allowed CIDRs.`);
        });

    configCmd
        .command('list')
        .description('Show current plugin configuration')
        .action(() => {
            const paths = getPluginPaths(version);
            const configPath = join(paths.userDataDir, 'plugin.json');

            if (!existsSync(configPath)) {
                console.log('No plugin config found.');
                return;
            }

            try {
                const config = JSON.parse(readFileSync(configPath, 'utf-8'));
                console.log(JSON.stringify(config, null, 2));
            } catch {
                console.error('Failed to read plugin config.');
            }
        });
}
