import type { CliContext, DispatcherHandler, CommandDispatcher } from '../types';
import { loadRoutineFile, validateRoutine } from './loader';
import { executeRoutine } from './executor';

export interface DispatcherConfig {
    commandMap?: Record<string, { operationId: string; pathParams: string[]; queryParams: string[]; hasBody: boolean }>;
    client?: any;
    consumerHandlers?: Map<string, DispatcherHandler>;
    preDispatch?: (command: string, args: Record<string, unknown>, ctx: CliContext) => Promise<void>;
    ctx: CliContext;
    routinesDir: string;
    builtinsMap?: Record<string, string>;
    /** @internal — test injection for loadRoutineFile */
    _loadRoutineFile?: typeof loadRoutineFile;
    /** @internal — test injection for validateRoutine */
    _validateRoutine?: typeof validateRoutine;
    /** @internal — test injection for executeRoutine */
    _executeRoutine?: typeof executeRoutine;
}

export function buildDispatcher(config: DispatcherConfig): CommandDispatcher {
    const _load = config._loadRoutineFile ?? loadRoutineFile;
    const _validate = config._validateRoutine ?? validateRoutine;
    const _execute = config._executeRoutine ?? executeRoutine;

    const dispatch: CommandDispatcher = async (
        command: string,
        args: Record<string, unknown>,
        positionalArgs?: unknown[],
    ): Promise<unknown> => {
    // 1. Pre-dispatch hook
        if (config.preDispatch) {
            await config.preDispatch(command, args, config.ctx);
        }

        // 2. Generated command-map
        if (config.commandMap && config.commandMap[command]) {
            const mapping = config.commandMap[command]!;
            const methodName = mapping.operationId;
            const method = config.client?.[methodName];
            if (!method) throw new Error(`Client method "${methodName}" not found`);

            const callArgs: unknown[] = [];
            const posArgs = positionalArgs ? [...positionalArgs] : [];

            // Path params from positional args or flags — accept both --camelCase and --kebab-case
            for (const param of mapping.pathParams) {
                const kebab = `--${param.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
                const camel = `--${param}`;
                callArgs.push(posArgs.shift() ?? args[kebab] ?? args[camel]);
            }

            // Body from args
            if (mapping.hasBody) {
                if (args['--body']) {
                    callArgs.push(JSON.parse(args['--body'] as string));
                } else {
                    const body: Record<string, unknown> = {};
                    for (const [key, val] of Object.entries(args)) {
                        if (key.startsWith('--') && key !== '--body' && key !== '--body-file') {
                            // Skip path params and query params — they're handled separately
                            const isPathParam = mapping.pathParams.some(
                                (p: string) => `--${p.replace(/([A-Z])/g, '-$1').toLowerCase()}` === key || `--${p}` === key,
                            );
                            const isQueryParam = mapping.queryParams.some(
                                (p: string) => `--${p.replace(/([A-Z])/g, '-$1').toLowerCase()}` === key || `--${p}` === key,
                            );
                            if (!isPathParam && !isQueryParam) {
                                const propName = key.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
                                body[propName] = val;
                            }
                        }
                    }
                    if (Object.keys(body).length > 0) callArgs.push(body);
                }
            }

            // Query params — accept both --camelCase and --kebab-case flags
            if (mapping.queryParams.length > 0) {
                const queryObj: Record<string, unknown> = {};
                for (const param of mapping.queryParams) {
                    const kebab = `--${param.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
                    const camel = `--${param}`;
                    const val = args[kebab] ?? args[camel];
                    if (val !== undefined) queryObj[param] = val;
                }
                if (Object.keys(queryObj).length > 0) callArgs.push(queryObj);
            }

            return await method.call(config.client, ...callArgs);
        }

        // 3. Consumer-registered dispatchers
        if (config.consumerHandlers?.has(command)) {
            const handler = config.consumerHandlers.get(command)!;
            return await handler(args, positionalArgs ?? [], config.ctx);
        }

        // 4. Built-in meta-commands

        // wait-until — poll with --interval (default 3s) and --timeout (default 120s) until truthy result
        if (command === 'wait-until') {
            const pollCmd = String(positionalArgs?.[0] || '');
            if (!pollCmd) throw new Error('wait-until requires a command to poll');
            const interval = Number(args['--interval'] || 3) * 1000;
            const timeout = Number(args['--timeout'] || 120) * 1000;

            const pollArgs: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(args)) {
                if (!['--interval', '--timeout'].includes(k)) pollArgs[k] = v;
            }

            const startTime = Date.now();
            let polls = 0;
            while (Date.now() - startTime < timeout) {
                try {
                    const result = await dispatch(pollCmd, pollArgs, positionalArgs?.slice(1));
                    // Truthy check: non-zero number, non-empty string/array/object
                    if (
                        result !== 0
                        && result !== null
                        && result !== undefined
                        && result !== ''
                        && !(Array.isArray(result) && result.length === 0)
                    ) {
                        if (polls > 0) process.stderr.write('\n');
                        return result;
                    }
                } catch {
                    // Poll command failed — keep trying
                }
                polls++;
                await new Promise(r => setTimeout(r, interval));
                process.stderr.write('.');
            }
            if (polls > 0) process.stderr.write('\n');
            throw new Error(`wait-until timed out after ${timeout / 1000}s waiting for truthy result from: ${pollCmd}`);
        }

        // session refresh — call ctx.refreshSession()
        if (command === 'session refresh') {
            await config.ctx.refreshSession();
            return { refreshed: true };
        }

        // routine run — load and execute sub-routine
        if (command === 'routine run') {
            const routineName = String(positionalArgs?.[0] || '');
            if (!routineName) throw new Error('routine run requires a routine name');
            const subDef = _load(routineName, config.routinesDir, config.builtinsMap);
            const subErrors = _validate(subDef);
            if (subErrors.length > 0) throw new Error(`Sub-routine validation failed: ${subErrors.join(', ')}`);

            // Pass through any --set- overrides from args
            const subOverrides: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(args)) {
                if (k.startsWith('--set-')) subOverrides[k.slice(6)] = v;
            }

            const result = await _execute(subDef, subOverrides, dispatch);
            if (!result.success) throw new Error(`Sub-routine "${routineName}" failed`);
            return result;
        }

        // 5. Unknown command
        throw new Error(`Unknown command: "${command}"`);
    };

    return dispatch;
}
