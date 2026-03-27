import type { OpenApiOperation, OpenApiSchema } from './openapi-types';
import { HTTP_METHODS } from './openapi-types';
import { normalizeTag } from './util';

/**
 * Generate a command map that maps CLI command paths to their
 * operationId, path params, query params, body presence, and description.
 * Uses the same grouping and verb deduplication logic as generateCommands.
 */
export function generateCommandMap(
    paths: Record<string, Record<string, OpenApiOperation>>,
    schemas: Record<string, OpenApiSchema> = {},
): string {
    // Build same grouping as generateCommands to get verb dedup
    const groups = new Map<
        string,
        Map<
            string,
            Array<{
                verb: string;
                operationId: string;
                pathParams: string[];
                queryParams: string[];
                hasBody: boolean;
                summary?: string;
            }>
        >
    >();

    for (const [path, methods] of Object.entries(paths)) {
        const pathLevelParams: NonNullable<OpenApiOperation['parameters']> = (methods as any).parameters || [];

        for (const method of HTTP_METHODS) {
            const op = methods[method] as OpenApiOperation | undefined;
            if (!op || !op.operationId) continue;

            const tag = op.tags?.[0] || 'default';
            const tokens = normalizeTag(tag);
            const groupKey = tokens[0];
            const resourceKey
                = tokens.length > 1 ? tokens.slice(1).join('-') : null;

            // Merge path-level params with operation params (op overrides by name+in)
            const opParams = op.parameters || [];
            const mergedParams: typeof opParams = [...pathLevelParams];
            for (const opParam of opParams) {
                const idx = mergedParams.findIndex(p => p.name === opParam.name && p.in === opParam.in);
                if (idx >= 0) mergedParams[idx] = opParam;
                else mergedParams.push(opParam);
            }

            const pathParams = mergedParams.filter(
                p => p.in === 'path',
            );
            const queryParams = mergedParams.filter(
                p => p.in === 'query',
            );
            const bodySchema
                = op.requestBody?.content?.['application/json']?.schema;
            const hasBody = !!bodySchema;
            const hasPathId = pathParams.length > 0;

            let verb: string;
            switch (method) {
                case 'get':
                    verb = hasPathId ? 'get' : 'list';
                    break;
                case 'post':
                    verb = 'create';
                    break;
                case 'put':
                    verb = 'update';
                    break;
                case 'delete':
                    verb = 'delete';
                    break;
                case 'patch':
                    verb = 'patch';
                    break;
                default:
                    verb = method;
            }

            const rKey = resourceKey || '__root__';
            if (!groups.has(groupKey)) groups.set(groupKey, new Map());
            const group = groups.get(groupKey)!;
            if (!group.has(rKey)) group.set(rKey, []);
            group.get(rKey)!.push({
                verb,
                operationId: op.operationId,
                pathParams: pathParams.map(p => p.name),
                queryParams: queryParams.map(p => p.name),
                hasBody,
                summary: op.summary || op.description,
            });
        }
    }

    const entries: string[] = [];

    for (const [groupName, resources] of groups) {
        for (const [resourceName, cmds] of resources) {
            // Same dedup logic as generateCommands
            const verbCounts = new Map<string, number>();
            for (const cmd of cmds) {
                verbCounts.set(cmd.verb, (verbCounts.get(cmd.verb) || 0) + 1);
            }

            for (const cmd of cmds) {
                const count = verbCounts.get(cmd.verb) || 1;
                let cmdName = cmd.verb;
                if (count > 1) {
                    cmdName = cmd.operationId
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase()
                        .replace(/^-/, '');
                }

                const cmdPath
                    = resourceName === '__root__'
                        ? `${groupName} ${cmdName}`
                        : `${groupName} ${resourceName} ${cmdName}`;

                const descPart = cmd.summary ? `, description: "${cmd.summary.replace(/"/g, '\\"')}"` : '';
                entries.push(
                    `  "${cmdPath}": { operationId: "${cmd.operationId}", pathParams: [${cmd.pathParams.map(p => `"${p}"`).join(', ')}], queryParams: [${cmd.queryParams.map(p => `"${p}"`).join(', ')}], hasBody: ${cmd.hasBody}${descPart} },`,
                );
            }
        }
    }

    return [
        '// Auto-generated — do not edit',
        '',
        'export interface CommandMapping {',
        '  operationId: string;',
        '  pathParams: string[];',
        '  queryParams: string[];',
        '  hasBody: boolean;',
        '  description?: string;',
        '}',
        '',
        'export const commandMap: Record<string, CommandMapping> = {',
        ...entries,
        '};',
    ].join('\n');
}
