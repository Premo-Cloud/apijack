import { describe, it, expect, beforeAll } from 'bun:test';
import { generate } from '../../src/codegen/index';
import { mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const STRIPE_SPEC_URL
    = 'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.sdk.json';

let spec: any;
let outDir: string;
let typesOutput: string;
let clientOutput: string;
let commandsOutput: string;
let commandMapOutput: string;

beforeAll(async () => {
    // Download Stripe spec — skip suite if unavailable (offline, rate-limited,
    // or just slow). Two deadlines matter here and they must not be equal:
    // the fetch is bounded well inside the hook's own timeout, so a slow or
    // hanging response lands in the catch below instead of blowing the hook's
    // deadline. A timed-out hook is reported as a hard test failure, not a
    // skip — which is how a GitHub 429 on raw.githubusercontent.com (7-15s to
    // respond, against bun's 5s default) once blocked a release even though
    // this suite is designed to opt out when the spec can't be fetched.
    try {
        const res = await fetch(STRIPE_SPEC_URL, { signal: AbortSignal.timeout(20_000) });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        spec = await res.json();
    } catch {
        spec = null;

        return;
    }

    outDir = await mkdtemp(join(tmpdir(), 'apijack-stripe-e2e-'));
    await generate({ spec, outDir });

    typesOutput = await Bun.file(join(outDir, 'types.ts')).text();
    clientOutput = await Bun.file(join(outDir, 'client.ts')).text();
    commandsOutput = await Bun.file(join(outDir, 'commands.ts')).text();
    commandMapOutput = await Bun.file(join(outDir, 'command-map.ts')).text();
    // Explicit hook timeout: the default 5s is shorter than a healthy download
    // of this spec, let alone a throttled one.
}, 60_000);

function skipIfOffline() {
    if (!spec) {
        console.log('    ⏭ skipped (Stripe spec not available)');

        return true;
    }

    return false;
}

describe('Stripe OpenAPI e2e', () => {
    // --- Coverage ---

    it('generates a type for every schema', () => {
        if (skipIfOffline()) return;

        const schemaCount = Object.keys(spec.components.schemas).length;
        const declarations = typesOutput.match(/export (interface|type) /g) || [];
        expect(declarations.length).toBe(schemaCount);
    });

    it('generates a method for every operation', () => {
        if (skipIfOffline()) return;

        let opCount = 0;

        for (const methods of Object.values(spec.paths) as any[]) {
            for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
                if (methods[m]?.operationId) opCount++;
            }
        }

        const asyncMethods = clientOutput.match(/^\s+async \w+\(/gm) || [];
        expect(asyncMethods.length).toBe(opCount);
    });

    // --- No invalid identifiers ---

    it('produces no dot-notation in type declarations', () => {
        if (skipIfOffline()) return;

        const dotDeclarations = typesOutput.match(
            /export (interface|type) \S*\.\S*/g,
        );
        expect(dotDeclarations).toBeNull();
    });

    it("produces no 'any' typed fields", () => {
        if (skipIfOffline()) return;

        const anyFields = (typesOutput.match(/: any;/g) || []).length;
        expect(anyFields).toBe(0);
    });

    // --- No name collisions ---

    it('has no duplicate type declarations', () => {
        if (skipIfOffline()) return;

        const names = [
            ...typesOutput.matchAll(/export (interface|type) (\w+)/g),
        ].map(m => m[2]);
        const unique = new Set(names);
        expect(names.length).toBe(unique.size);
    });

    // --- TypeScript validity ---

    it('types.ts compiles without errors', async () => {
        if (skipIfOffline()) return;

        const typesPath = join(outDir, 'types.ts');
        const proc = Bun.spawn(['bun', 'build', '--no-bundle', typesPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            expect(stderr).toBe('');
        }

        expect(exitCode).toBe(0);
    });

    // --- Dot-notation schemas specifically ---

    it('sanitizes billing.alert to billing__alert', () => {
        if (skipIfOffline()) return;

        expect(typesOutput).toContain('export interface billing__alert {');
    });

    it('avoids collision between billing.alert.triggered and billing.alert_triggered', () => {
        if (skipIfOffline()) return;

        expect(typesOutput).toContain('export interface billing__alert__triggered {');
        expect(typesOutput).toContain('export interface billing__alert_triggered {');
    });

    // --- All files generated ---

    it('generates all four output files', () => {
        if (skipIfOffline()) return;

        expect(typesOutput.length).toBeGreaterThan(0);
        expect(clientOutput.length).toBeGreaterThan(0);
        expect(commandsOutput.length).toBeGreaterThan(0);
        expect(commandMapOutput.length).toBeGreaterThan(0);
    });
});
