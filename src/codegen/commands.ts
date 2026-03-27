import type {
    OpenApiOperation,
    OpenApiSchema,
    CommandDef,
} from './openapi-types';
import { HTTP_METHODS } from './openapi-types';
import {
    schemaToTsType,
    normalizeTag,
    resolveSchemaProps,
    sanitizeVar,
    capitalize,
} from './util';

/**
 * Generate Commander subcommands grouped by OpenAPI tags.
 * Uses onResult callback for output handling.
 */
export function generateCommands(
    paths: Record<string, Record<string, OpenApiOperation>>,
    schemas: Record<string, OpenApiSchema> = {},
): string {
    const groups = new Map<string, Map<string, CommandDef[]>>();

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
            const bodyIsArray = bodySchema?.type === 'array';
            const bodyProps = resolveSchemaProps(bodySchema, schemas);

            // Detect primitive body types that can't be decomposed into properties
            let bodyPrimitiveType: CommandDef['bodyPrimitiveType'];
            if (hasBody && bodyProps.length === 0 && bodySchema) {
                const resolved = bodySchema.$ref
                    ? schemas[bodySchema.$ref.split('/').pop()!]
                    : bodySchema;
                if (resolved) {
                    if (resolved.type === 'string') bodyPrimitiveType = 'string';
                    else if (
                        resolved.type === 'integer'
                        || resolved.type === 'number'
                    )
                        bodyPrimitiveType = 'number';
                    else if (resolved.type === 'boolean')
                        bodyPrimitiveType = 'boolean';
                    else if (resolved.type === 'array' && resolved.items && typeof resolved.items !== 'boolean') {
                        const itemType = resolved.items.$ref
                            ? schemas[resolved.items.$ref.split('/').pop()!]?.type
                            : resolved.items.type;
                        if (itemType === 'string') bodyPrimitiveType = 'string[]';
                        else if (itemType === 'integer' || itemType === 'number')
                            bodyPrimitiveType = 'number[]';
                    }
                }
            }

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

            const cmd: CommandDef = {
                verb,
                operationId: op.operationId,
                pathParams: pathParams.map(p => ({
                    name: p.name,
                    type: schemaToTsType(p.schema),
                    description: p.description,
                })),
                queryParams: queryParams.map(p => ({
                    name: p.name,
                    type: schemaToTsType(p.schema),
                    enumValues: p.schema.enum,
                    description: p.description,
                    default: p.schema.default,
                    format: p.schema.format,
                    style: p.style,
                })),
                hasBody,
                bodyIsArray,
                bodyProps,
                bodyPrimitiveType,
                description: `${method.toUpperCase()} ${path}`,
                summary: op.summary || op.description,
                deprecated: op.deprecated,
            };

            if (!groups.has(groupKey)) groups.set(groupKey, new Map());
            const group = groups.get(groupKey)!;
            const rKey = resourceKey || '__root__';
            if (!group.has(rKey)) group.set(rKey, []);
            group.get(rKey)!.push(cmd);
        }
    }

    const lines: string[] = [
        '// Auto-generated — do not edit',
        'import { Command, Option } from "commander";',
        'import type { ApiClient } from "./client";',
        '',
        'type OutputHandler = (result: unknown) => void;',
        '',
        'export function registerGeneratedCommands(program: Command, client: ApiClient, onResult: OutputHandler): void {',
    ];

    for (const [groupName, resources] of groups) {
        lines.push(
            `  const ${sanitizeVar(groupName)} = program.command("${groupName}");`,
        );

        for (const [resourceName, cmds] of resources) {
            let parent: string;
            if (resourceName === '__root__') {
                parent = sanitizeVar(groupName);
            } else {
                const varName
                    = sanitizeVar(groupName) + capitalize(sanitizeVar(resourceName));
                lines.push(
                    `  const ${varName} = ${sanitizeVar(groupName)}.command("${resourceName}");`,
                );
                parent = varName;
            }

            // Deduplicate verb names within the same parent
            const verbCounts = new Map<string, number>();
            for (const cmd of cmds) {
                verbCounts.set(cmd.verb, (verbCounts.get(cmd.verb) || 0) + 1);
            }
            const verbSeen = new Map<string, number>();

            for (const cmd of cmds) {
                const count = verbCounts.get(cmd.verb) || 1;
                let cmdName = cmd.verb;
                if (count > 1) {
                    // Use operationId as the command name when verbs collide
                    cmdName = cmd.operationId
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase()
                        .replace(/^-/, '');
                }
                verbSeen.set(
                    cmd.verb,
                    (verbSeen.get(cmd.verb) || 0) + 1,
                );

                const hasVariantProps
                    = cmd.hasBody && cmd.bodyProps.some(bp => bp.variant);
                const argStr = cmd.pathParams
                    .map(p => ` <${p.name}>`)
                    .join('');
                const arrayNote = cmd.bodyIsArray
                    ? ' — body is an array, flags build a single item'
                    : '';

                // Commands with variant props need a variable reference for configureHelp
                if (hasVariantProps) {
                    lines.push(
                        `  const _${cmd.operationId} = ${parent}`,
                    );
                } else {
                    lines.push(`  ${parent}`);
                }
                lines.push(`    .command("${cmdName}${argStr}")`);

                let cmdDesc: string;
                if (cmd.deprecated) {
                    cmdDesc = `[DEPRECATED] ${cmd.summary || cmd.description}`;
                } else if (cmd.summary) {
                    cmdDesc = `${cmd.summary} — ${cmd.description}`;
                } else {
                    cmdDesc = cmd.description;
                }
                lines.push(
                    `    .description("${cmdDesc.replace(/"/g, '\\"')}${arrayNote} (use -o routine-step to export as YAML)")`,
                );

                for (const qp of cmd.queryParams) {
                    const qpEnum = qp.enumValues
                        ? ` [${qp.enumValues.join(', ')}]`
                        : '';
                    const qpFormat = qp.format ? ` (${qp.format})` : '';
                    const qpDefault = qp.default !== undefined ? ` (default: ${qp.default})` : '';
                    const qpStyle = qp.style ? ` (style: ${qp.style})` : '';
                    const qpDesc = qp.description
                        ? `${qp.description}${qpEnum}${qpFormat}${qpDefault}${qpStyle}`
                        : `${qp.name}${qpEnum}${qpFormat}${qpDefault}${qpStyle}`;
                    lines.push(
                        `    .option("--${qp.name} <${qp.name}>", "${qpDesc.replace(/"/g, '\\"')}")`,
                    );
                }

                if (cmd.hasBody) {
                    if (cmd.bodyPrimitiveType) {
                        // Primitive or array-of-primitive body — single --value/--values flag
                        if (cmd.bodyPrimitiveType.endsWith('[]')) {
                            const itemType = cmd.bodyPrimitiveType.slice(0, -2);
                            lines.push(
                                `    .option("--values <values>", "Comma-separated ${itemType} values")`,
                            );
                        } else {
                            lines.push(
                                `    .option("--value <value>", "Body value (${cmd.bodyPrimitiveType})")`,
                            );
                        }
                    } else {
                        for (const bp of cmd.bodyProps) {
                            let desc: string = bp.description || bp.name;
                            if (bp.enumValues) desc += ` [${bp.enumValues.join(', ')}]`;
                            if (bp.format) desc += ` (${bp.format})`;
                            if (bp.default !== undefined) desc += ` (default: ${bp.default})`;

                            const variantTag = bp.variant
                                ? ` (${bp.variant})`
                                : '';
                            const escapedDesc = desc.replace(/"/g, '\\"');

                            if (bp.variant) {
                                // Variant-specific: hidden by default, shown with --verbose
                                lines.push(
                                    `    .addOption(new Option("--${bp.cliFlag} <value>", "${escapedDesc}${variantTag}").hideHelp())`,
                                );
                            } else if (bp.required) {
                                lines.push(
                                    `    .requiredOption("--${bp.cliFlag} <value>", "${escapedDesc} (required)")`,
                                );
                            } else {
                                lines.push(
                                    `    .option("--${bp.cliFlag} <value>", "${escapedDesc}")`,
                                );
                            }
                        }
                    }
                    lines.push(
                        '    .option("--body <json>", "Raw JSON body (overrides individual flags)")',
                    );
                    lines.push(
                        '    .option("--body-file <path>", "Read body from file (overrides individual flags)")',
                    );
                    if (hasVariantProps) {
                        lines.push(
                            '    .option("--verbose", "Show all variant-specific flags in help")',
                        );
                    }
                }

                lines.push(
                    '    .action(async (...actionArgs: unknown[]) => {',
                );

                const totalPositional = cmd.pathParams.length;
                for (let i = 0; i < cmd.pathParams.length; i++) {
                    lines.push(
                        `      const ${cmd.pathParams[i].name} = actionArgs[${i}] as ${cmd.pathParams[i].type};`,
                    );
                }
                lines.push(
                    `      const opts = actionArgs[${totalPositional}] as Record<string, unknown>;`,
                );

                const callArgs: string[] = [];
                for (const pp of cmd.pathParams) callArgs.push(pp.name);
                if (cmd.hasBody) {
                    lines.push('      let body: any;');
                    lines.push(
                        '      if (opts.bodyFile) { body = JSON.parse(await Bun.file(opts.bodyFile as string).text()); }',
                    );
                    lines.push(
                        '      else if (opts.body) { body = JSON.parse(opts.body as string); }',
                    );
                    if (cmd.bodyPrimitiveType) {
                        // Primitive body — convert from CLI flag
                        if (cmd.bodyPrimitiveType === 'string[]') {
                            lines.push(
                                '      else if (opts.values) { body = (opts.values as string).split(","); }',
                            );
                        } else if (cmd.bodyPrimitiveType === 'number[]') {
                            lines.push(
                                '      else if (opts.values) { body = (opts.values as string).split(",").map(Number); }',
                            );
                        } else if (cmd.bodyPrimitiveType === 'number') {
                            lines.push(
                                '      else if (opts.value !== undefined) { body = Number(opts.value); }',
                            );
                        } else if (cmd.bodyPrimitiveType === 'boolean') {
                            lines.push(
                                '      else if (opts.value !== undefined) { body = opts.value === "true"; }',
                            );
                        } else {
                            // string
                            lines.push(
                                '      else if (opts.value !== undefined) { body = opts.value; }',
                            );
                        }
                    } else if (cmd.bodyProps.length > 0) {
                        lines.push('      else {');
                        lines.push(
                            '        const obj: Record<string, unknown> = {};',
                        );
                        for (const bp of cmd.bodyProps) {
                            lines.push(
                                `        if (opts.${bp.camelName} !== undefined) obj["${bp.name}"] = opts.${bp.camelName};`,
                            );
                        }
                        if (cmd.bodyIsArray) {
                            lines.push(
                                '        body = [obj]; // API expects an array',
                            );
                        } else {
                            lines.push('        body = obj;');
                        }
                        lines.push('      }');
                    }
                    callArgs.push('body');
                }
                if (cmd.queryParams.length > 0) {
                    const qpObj = cmd.queryParams
                        .map(p => `${p.name}: opts.${p.name}`)
                        .join(', ');
                    callArgs.push(`{ ${qpObj} }`);
                }

                lines.push(
                    `      const result = await client.${cmd.operationId}(${callArgs.join(', ')});`,
                );
                lines.push('      onResult(result);');
                lines.push('    });');

                // For commands with variant props, configure help to show hidden options with --verbose
                if (hasVariantProps) {
                    lines.push(`  _${cmd.operationId}.configureHelp({`);
                    lines.push('    visibleOptions: (cmd) => {');
                    lines.push(
                        '      if (process.argv.includes("--verbose")) {',
                    );
                    lines.push('        return cmd.options;');
                    lines.push('      }');
                    lines.push(
                        '      return cmd.options.filter((o) => !o.hidden);',
                    );
                    lines.push('    },');
                    lines.push('  });');
                }

                lines.push('');
            }
        }
    }

    lines.push('}');
    return lines.join('\n');
}
