import type { Command } from 'commander';
import type { AuthStrategy, AuthSession, ResolvedAuth } from './auth/types';

export interface CliContext {
    client: any;
    session: AuthSession;
    auth: ResolvedAuth;
    strategy: AuthStrategy;
    refreshSession(): Promise<void>;
}

export interface CliOptions {
    name: string;
    description: string;
    version: string;
    specPath: string;
    auth: AuthStrategy;
    outputModes?: string[];
    generatedDir?: string;
    knownSites?: Record<string, { url: string; description: string; group?: string }>;
    setupHook?: () => Promise<void>;
    builtinRoutinesDir?: string;
    preDispatch?: (command: string, args: Record<string, unknown>, ctx: CliContext) => Promise<void>;
    allowedCidrs?: string[];
}

export type CommandRegistrar = (program: Command, ctx: CliContext) => void;

export type DispatcherHandler = (
    args: Record<string, unknown>,
    positionalArgs: unknown[],
    ctx: CliContext,
) => Promise<unknown>;

export type CommandDispatcher = (
    command: string,
    args: Record<string, unknown>,
    positionalArgs?: unknown[],
) => Promise<unknown>;
