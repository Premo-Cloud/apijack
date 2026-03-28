import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRoutineTool } from './create-routine';
import type { McpContext } from '../../../types';

function makeCtx(overrides: Partial<McpContext> = {}): McpContext {
    return {
        cliName: 'testcli',
        cliInvocation: ['/usr/bin/testcli'],
        generatedDir: '/fake/generated',
        routinesDir: '/fake/routines',
        ...overrides,
    };
}

describe('create_routine tool', () => {
    test('creates routine file with .yaml appended when extension missing', async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'apijack-test-'));
        try {
            const ctx = makeCtx({ routinesDir: tmpDir });
            const content = 'name: my-routine\nsteps:\n  - name: step1\n    command: todos list\n';

            const result = await createRoutineTool.handler(
                { name: 'my-routine', content },
                ctx,
            );

            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toContain('my-routine.yaml');

            const written = readFileSync(join(tmpDir, 'my-routine.yaml'), 'utf8');
            expect(written).toBe(content);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('does not double-append .yaml when name already has extension', async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'apijack-test-'));
        try {
            const ctx = makeCtx({ routinesDir: tmpDir });
            const content = 'name: setup\nsteps: []\n';

            const result = await createRoutineTool.handler(
                { name: 'setup.yaml', content },
                ctx,
            );

            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toContain('setup.yaml');
            // Should not create setup.yaml.yaml
            const written = readFileSync(join(tmpDir, 'setup.yaml'), 'utf8');
            expect(written).toBe(content);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('creates routines directory if it does not exist', async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'apijack-test-'));
        const routinesDir = join(tmpDir, 'nested', 'routines');
        try {
            const ctx = makeCtx({ routinesDir });
            const content = 'name: test\nsteps: []\n';

            const result = await createRoutineTool.handler(
                { name: 'test', content },
                ctx,
            );

            expect(result.isError).toBeUndefined();
            const written = readFileSync(join(routinesDir, 'test.yaml'), 'utf8');
            expect(written).toBe(content);
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
