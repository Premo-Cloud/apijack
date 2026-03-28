import { describe, test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
import { listRoutinesTool } from './list-routines';
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

describe('list_routines tool', () => {
    test('returns routine names from structured list', async () => {
        const routinesDir = import.meta.dir + '/fixtures/routines';
        mkdirSync(routinesDir, { recursive: true });
        writeFileSync(
            routinesDir + '/test-routine.yaml',
            'name: test-routine\nsteps:\n  - name: step1\n    command: admin list\n',
        );

        const ctx = makeCtx({ routinesDir });
        const result = await listRoutinesTool.handler({}, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('test-routine');
    });

    test('returns message when no routines found', async () => {
        const ctx = makeCtx({ routinesDir: '/nonexistent/routines' });
        const result = await listRoutinesTool.handler({}, ctx);

        expect(result.content[0].text).toContain('No routines found');
    });
});
