import { mkdir } from 'fs/promises';
import { generateTypes } from './types';
import { generateClient } from './client';
import { generateCommands } from './commands';
import { generateCommandMap } from './command-map';

export interface GenerateOptions {
    spec: {
        paths: Record<string, any>;
        components?: { schemas?: Record<string, any> };
    };
    outDir: string;
}

export interface FetchAndGenerateOptions {
    baseUrl: string;
    specPath: string;
    outDir: string;
    auth?: { username: string; password: string };
}

export async function generate(opts: GenerateOptions): Promise<void> {
    const schemas = opts.spec.components?.schemas || {};
    const paths = opts.spec.paths || {};

    const typesContent = generateTypes(schemas);
    const clientContent = generateClient(paths, schemas);
    const commandsContent = generateCommands(paths, schemas);
    const commandMapContent = generateCommandMap(paths, schemas);

    await mkdir(opts.outDir, { recursive: true });

    await Bun.write(`${opts.outDir}/types.ts`, typesContent);
    await Bun.write(`${opts.outDir}/client.ts`, clientContent);
    await Bun.write(`${opts.outDir}/commands.ts`, commandsContent);
    await Bun.write(`${opts.outDir}/command-map.ts`, commandMapContent);
}

export async function fetchAndGenerate(
    opts: FetchAndGenerateOptions,
): Promise<void> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.auth) {
        headers.Authorization
            = 'Basic ' + btoa(`${opts.auth.username}:${opts.auth.password}`);
    }

    const url = `${opts.baseUrl}${opts.specPath}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(
            `Failed to fetch spec from ${url}: ${res.status} ${res.statusText}`,
        );
    }

    const spec = await res.json();
    await generate({ spec, outDir: opts.outDir });
}
