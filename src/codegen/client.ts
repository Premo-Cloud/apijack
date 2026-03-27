import type { OpenApiOperation, OpenApiSchema } from './openapi-types';
import { HTTP_METHODS } from './openapi-types';
import { schemaToTsType, refToName, resolveType, resolveResponseType } from './util';

/**
 * Generate an ApiClient class from OpenAPI paths.
 * The class has a HeadersProvider, a private request() method,
 * and one method per operationId with typed return values and JSDoc.
 */
export function generateClient(
    paths: Record<string, Record<string, OpenApiOperation>>,
    schemas: Record<string, OpenApiSchema> = {},
): string {
    const referencedTypes = new Set<string>();
    const PRIMITIVE_TYPES = new Set(['void', 'string', 'number', 'boolean', 'unknown']);

    /** Extract importable named types from a type string (handles unions, intersections, arrays) */
    function collectImportableTypes(typeStr: string) {
    // Strip array suffix and parens from discriminated union wrappers
        const bare = typeStr.replace(/\[\]$/g, '').replace(/^\(|\)$/g, '');
        // Split on union/intersection operators
        for (const part of bare.split(/\s*[|&]\s*/)) {
            const trimmed = part.trim().replace(/\[\]$/g, '');
            if (trimmed && !PRIMITIVE_TYPES.has(trimmed) && /^[A-Za-z_]\w*$/.test(trimmed)) {
                referencedTypes.add(trimmed);
            }
        }
    }

    const methodLines: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
        const pathLevelParams: NonNullable<OpenApiOperation['parameters']> = (methods as any).parameters || [];

        for (const method of HTTP_METHODS) {
            const op = methods[method] as OpenApiOperation | undefined;
            if (!op || !op.operationId) continue;

            // Merge path-level params with operation params (op overrides by name+in)
            const opParams = op.parameters || [];
            const mergedParams: typeof opParams = [...pathLevelParams];
            for (const opParam of opParams) {
                const idx = mergedParams.findIndex(p => p.name === opParam.name && p.in === opParam.in);
                if (idx >= 0) mergedParams[idx] = opParam;
                else mergedParams.push(opParam);
            }

            const pathParams = mergedParams.filter(p => p.in === 'path');
            const queryParams = mergedParams.filter(p => p.in === 'query');

            const args: string[] = [];
            for (const p of pathParams) {
                args.push(`${p.name}: ${schemaToTsType(p.schema)}`);
            }

            const bodySchema = op.requestBody?.content?.['application/json']?.schema;
            if (bodySchema) {
                const bodyType = bodySchema.$ref
                    ? refToName(bodySchema.$ref)
                    : resolveType(bodySchema, schemas);
                args.push(`body: ${bodyType}`);
                collectImportableTypes(bodyType);
            }

            if (queryParams.length > 0) {
                const qFields = queryParams.map(p => `${p.name}?: ${schemaToTsType(p.schema)}`).join('; ');
                args.push(`params?: { ${qFields} }`);
            }

            // Resolve return type
            const returnType = op.responses
                ? resolveResponseType(op.responses, schemas)
                : 'void';
            collectImportableTypes(returnType);

            const pathTemplate = pathParams.length > 0
                ? `\`${path.replace(/\{(\w+)\}/g, '${$1}')}\``
                : `"${path}"`;

            const reqOpts: string[] = [];
            if (queryParams.length > 0) reqOpts.push('params');
            if (bodySchema) reqOpts.push('body');
            const optsArg = reqOpts.length > 0 ? `, { ${reqOpts.join(', ')} }` : '';

            // Build operation JSDoc
            const docLines: string[] = [];
            const summary = op.summary || '';
            const description = op.description || '';
            const isDeprecated = op.deprecated === true;
            const httpLine = `${method.toUpperCase()} ${path}`;

            if (isDeprecated && summary) {
                docLines.push(`@deprecated ${summary}`);
            } else if (isDeprecated && description) {
                docLines.push(`@deprecated ${description}`);
            } else if (isDeprecated) {
                docLines.push('@deprecated');
            } else if (summary) {
                docLines.push(summary);
            } else if (description) {
                docLines.push(description);
            }

            if (summary && description) {
                docLines.push(description);
            }

            docLines.push(httpLine);

            // @param tags for path parameters (always) and query parameters (when described)
            for (const p of pathParams) {
                let paramDesc = p.description ? `${p.description}` : p.name;
                if (p.style) paramDesc += ` (style: ${p.style}${p.explode !== undefined ? `, explode: ${p.explode}` : ''})`;
                docLines.push(`@param ${p.name} ${paramDesc}`);
            }
            for (const p of queryParams) {
                let paramDesc = p.description || p.name;
                if (p.style) paramDesc += ` (style: ${p.style}${p.explode !== undefined ? `, explode: ${p.explode}` : ''})`;
                if (paramDesc !== p.name || p.style) {
                    docLines.push(`@param ${p.name} ${paramDesc}`);
                }
            }

            // @param for body
            if (bodySchema) {
                const bodyDesc = op.requestBody?.description;
                if (bodyDesc) {
                    docLines.push(`@param body ${bodyDesc}`);
                } else {
                    docLines.push('@param body');
                }
            }

            // Emit JSDoc
            if (docLines.length === 1) {
                methodLines.push(`  /** ${docLines[0]} */`);
            } else {
                methodLines.push(`  /** ${docLines[0]}`);
                for (let i = 1; i < docLines.length; i++) {
                    if (i === docLines.length - 1) {
                        methodLines.push(`   * ${docLines[i]} */`);
                    } else {
                        methodLines.push(`   * ${docLines[i]}`);
                    }
                }
            }

            methodLines.push(`  async ${op.operationId}(${args.join(', ')}): Promise<${returnType}> {`);
            methodLines.push(`    return this.request("${method.toUpperCase()}", ${pathTemplate}${optsArg}) as Promise<${returnType}>;`);
            methodLines.push('  }');
            methodLines.push('');
        }
    }

    // Build the import statement
    const sortedTypes = [...referencedTypes].sort();
    const importLine = sortedTypes.length > 0
        ? `import type { ${sortedTypes.join(', ')} } from "./types";\n\n`
        : '';

    const lines: string[] = [
        '// Auto-generated — do not edit',
        '',
        importLine ? importLine.trimEnd() : null,
        'export type HeadersProvider = () => Record<string, string>;',
        '',
        'export class ApiClient {',
        '  constructor(private baseUrl: string, private getHeaders: HeadersProvider) {}',
        '',
        '  private async request(method: string, path: string, opts?: { params?: Record<string, unknown>; body?: unknown }): Promise<unknown> {',
        '    const url = new URL(path, this.baseUrl);',
        '    if (opts?.params) {',
        '      for (const [k, v] of Object.entries(opts.params)) {',
        '        if (v !== undefined) url.searchParams.set(k, String(v));',
        '      }',
        '    }',
        '    const headers: Record<string, string> = {',
        '      ...this.getHeaders(),',
        '      "Content-Type": "application/json",',
        '    };',
        '    const res = await fetch(url.toString(), {',
        '      method,',
        '      headers,',
        '      body: opts?.body ? JSON.stringify(opts.body) : undefined,',
        '    });',
        '    if (!res.ok) {',
        '      const text = await res.text();',
        '      throw { status: res.status, body: text };',
        '    }',
        '    const text = await res.text();',
        '    if (!text) return undefined;',
        '    return JSON.parse(text);',
        '  }',
        '',
        ...methodLines,
        '}',
    ].filter(l => l !== null);

    return lines.join('\n');
}
