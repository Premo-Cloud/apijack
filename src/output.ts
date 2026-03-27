import Table from 'cli-table3';

export type OutputMode = 'json' | 'table' | 'quiet';

export function formatOutput(data: unknown, mode: OutputMode): string {
    if (mode === 'quiet') return '';
    if (mode === 'table') return formatTable(data);
    return JSON.stringify(data, null, 2);
}

function formatTable(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0 || typeof data[0] !== 'object' || data[0] === null) {
        process.stderr.write('Warning: response is not a flat array of objects, falling back to JSON\n');
        return JSON.stringify(data, null, 2);
    }

    const keys = Object.keys(data[0] as Record<string, unknown>);
    const table = new Table({ head: keys });

    for (const row of data) {
        const obj = row as Record<string, unknown>;
        table.push(keys.map(k => String(obj[k] ?? '')));
    }

    return table.toString();
}
