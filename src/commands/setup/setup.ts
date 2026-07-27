import { Command } from 'commander';
import { saveEnvironment, verifyCredentials } from '../../config';
import type { EnvironmentConfig } from '../../config';
import { prompt, hiddenPrompt } from '../../prompt';

/** URL offered by the interactive setup prompts when a consumer configures none. */
export const DEFAULT_SETUP_URL = 'http://localhost:8080';

/** Resolve the URL pre-fill for the setup prompts — the consumer's `defaultUrl`, else the built-in default. */
export function setupUrlDefault(defaultUrl?: string): string {
    return defaultUrl || DEFAULT_SETUP_URL;
}

export interface SetupInput {
    cliName: string;
    envName: string;
    url: string;
    user: string;
    password: string;
    verify: (url: string, user: string, password: string) => Promise<{ ok: boolean; reason?: string }>;
    save: (cliName: string, envName: string, creds: EnvironmentConfig, switchTo: boolean, opts: Record<string, unknown>) => Promise<void>;
    saveOpts?: Record<string, unknown>;
}

export interface SetupResult {
    saved: boolean;
    verified: boolean;
    verifyReason?: string;
    envName: string;
}

export async function setupAction(input: SetupInput): Promise<SetupResult> {
    const { cliName, envName, url, user, password, verify, save, saveOpts } = input;

    const verifyResult = await verify(url, user, password);

    await save(cliName, envName, { url, user, password }, true, saveOpts ?? {});

    return {
        saved: true,
        verified: verifyResult.ok,
        verifyReason: verifyResult.ok ? undefined : verifyResult.reason,
        envName,
    };
}

export function registerSetupCommand(
    program: Command,
    cliName: string,
    opts?: {
        allowedCidrs?: string[];
        configPath?: string;
        /** Display name for user-facing output. Defaults to cliName. */
        displayName?: string;
        /** URL pre-filled in the setup prompt. Defaults to `DEFAULT_SETUP_URL`. */
        defaultUrl?: string;
    },
): void {
    const displayName = opts?.displayName ?? cliName;
    const urlDefault = setupUrlDefault(opts?.defaultUrl);
    const action = async (cmdOpts: { allowInsecureStorage?: boolean }) => {
        console.log(`${displayName} Setup\n`);

        const envName = await prompt('Environment name [default]: ', 'default');
        const url = await prompt(`URL [${urlDefault}]: `, urlDefault);
        const user = await prompt('Username/Email: ');
        const password = await hiddenPrompt('Password: ');

        if (!user || !password) {
            console.error('Setup cancelled.');
            process.exit(2);
        }

        const configOpts = opts?.configPath ? { configPath: opts.configPath } : undefined;

        const result = await setupAction({
            cliName,
            envName,
            url,
            user,
            password,
            verify: verifyCredentials,
            save: saveEnvironment,
            saveOpts: {
                ...configOpts,
                allowInsecureStorage: cmdOpts.allowInsecureStorage,
                allowedCidrs: opts?.allowedCidrs,
            },
        });

        if (!result.verified) {
            console.error(result.verifyReason);
            console.error("Credentials saved anyway — they'll be used when the server is available.");
        } else {
            console.log('Credentials verified.');
        }

        console.log(`Saved environment '${envName}' to ~/.${cliName}/config.json`);
        console.log(`Switched to '${envName}'\n`);
    };

    program
        .command('setup')
        .description('Interactive setup — configure URL and credentials')
        .option('--allow-insecure-storage', 'Allow plaintext storage for production URLs')
        .action(action);
    program
        .command('login')
        .description('Alias for setup')
        .option('--allow-insecure-storage', 'Allow plaintext storage for production URLs')
        .action(action);
}
