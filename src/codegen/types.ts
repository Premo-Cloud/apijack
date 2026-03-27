import type { OpenApiSchema } from './openapi-types';
import { resolveType, refToName, buildJsDoc } from './util';

/**
 * Generate TypeScript type definitions from OpenAPI component schemas.
 * Produces interfaces for object schemas, union types for enums,
 * intersection types for allOf, and union types for oneOf/anyOf.
 * Includes JSDoc comments, required field tracking, additionalProperties,
 * discriminated unions, inline intersection members, and OAS 3.1 features
 * ($defs, const, not, prefixItems, type arrays, patternProperties).
 */
export function generateTypes(
    schemas: Record<string, OpenApiSchema>,
): string {
    // Flatten $defs from all schemas into the main schemas map
    const allSchemas = { ...schemas };
    for (const [, schema] of Object.entries(schemas)) {
        if (schema.$defs) {
            for (const [defName, defSchema] of Object.entries(schema.$defs)) {
                if (!allSchemas[defName]) {
                    allSchemas[defName] = defSchema;
                }
            }
        }
    }

    const lines: string[] = ['// Auto-generated — do not edit', ''];

    for (const [name, schema] of Object.entries(allSchemas)) {
        if (schema.const !== undefined) {
            // OAS 3.1: const — literal type alias
            const schemaDoc = buildJsDoc(schema);
            lines.push(...schemaDoc);
            const resolved = resolveType(schema, allSchemas);
            lines.push(`export type ${name} = ${resolved};`);
        } else if (schema.enum) {
            // Emit schema-level JSDoc (handles string, integer, mixed enums)
            const schemaDoc = buildJsDoc(schema);
            lines.push(...schemaDoc);
            const resolved = resolveType(schema, allSchemas);
            lines.push(`export type ${name} = ${resolved};`);
        } else if (schema.not && !schema.type && !schema.properties && !schema.allOf && !schema.oneOf && !schema.anyOf) {
            // OAS 3.1: not-only schema — emit unknown with JSDoc @not
            const schemaDoc = buildJsDoc(schema);
            lines.push(...schemaDoc);
            lines.push(`export type ${name} = unknown;`);
        } else if (schema.prefixItems) {
            // OAS 3.1: prefixItems — tuple type alias
            const schemaDoc = buildJsDoc(schema);
            lines.push(...schemaDoc);
            const resolved = resolveType(schema, allSchemas);
            lines.push(`export type ${name} = ${resolved};`);
        } else if (Array.isArray(schema.type) && !schema.properties) {
            // OAS 3.1: type array without properties — emit type alias via resolveType
            const schemaDoc = buildJsDoc(schema);
            lines.push(...schemaDoc);
            const resolved = resolveType(schema, allSchemas);
            lines.push(`export type ${name} = ${resolved};`);
        } else if (schema.type === 'object' || schema.properties) {
            // Emit schema-level JSDoc
            const schemaDoc = buildJsDoc({
                description: schema.description,
                deprecated: schema.deprecated,
                minProperties: schema.minProperties,
                maxProperties: schema.maxProperties,
            });
            lines.push(...schemaDoc);
            lines.push(`export interface ${name} {`);
            const requiredSet = new Set(schema.required || []);
            if (schema.properties) {
                for (const [propName, propSchema] of Object.entries(schema.properties)) {
                    const tsType = resolveType(propSchema, allSchemas, 0);
                    const propDoc = buildJsDoc(propSchema, '  ');
                    lines.push(...propDoc);
                    const optional = requiredSet.has(propName) ? '' : '?';
                    lines.push(`  ${propName}${optional}: ${tsType};`);
                }
            }
            // patternProperties — emit index signatures with JSDoc per pattern
            if (schema.patternProperties) {
                const patternTypes: string[] = [];
                for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
                    const patType = resolveType(patternSchema, allSchemas);
                    lines.push(`  /** Properties matching pattern: ${pattern} */`);
                    patternTypes.push(patType);
                }
                if (patternTypes.length > 0 && !schema.additionalProperties) {
                    const unionType = [...new Set(patternTypes)].join(' | ');
                    lines.push(`  [key: string]: ${unionType} | undefined;`);
                }
            }
            // additionalProperties
            if (schema.additionalProperties && schema.additionalProperties !== true) {
                const addType = resolveType(schema.additionalProperties, allSchemas, 0);
                lines.push(`  [key: string]: ${addType} | undefined;`);
            } else if (schema.additionalProperties === true) {
                lines.push('  [key: string]: unknown;');
            }
            lines.push('}');
        } else if (schema.allOf) {
            // Emit schema-level JSDoc
            const schemaDoc = buildJsDoc({ description: schema.description, deprecated: schema.deprecated });
            lines.push(...schemaDoc);
            // Merge required arrays from all parts
            const mergedRequired = new Set<string>();
            for (const part of schema.allOf) {
                if (part.required) {
                    for (const r of part.required) mergedRequired.add(r);
                }
            }
            const parts = schema.allOf.map((s) => {
                if (s.$ref) {
                    return refToName(s.$ref);
                }
                if (s.properties) {
                    // Inline intersection member with properties and JSDoc
                    const innerLines: string[] = ['{'];
                    const partRequired = new Set([...mergedRequired, ...(s.required || [])]);
                    for (const [propName, propSchema] of Object.entries(s.properties)) {
                        const propDoc = buildJsDoc(propSchema, '  ');
                        innerLines.push(...propDoc);
                        const tsType = resolveType(propSchema, allSchemas, 0);
                        const optional = partRequired.has(propName) ? '' : '?';
                        innerLines.push(`  ${propName}${optional}: ${tsType};`);
                    }
                    innerLines.push('}');
                    return innerLines.join('\n');
                }
                return 'unknown';
            });
            lines.push(`export type ${name} = ${parts.join(' & ')};`);
        } else if (schema.oneOf || schema.anyOf) {
            // Emit schema-level JSDoc
            const schemaDoc = buildJsDoc({ description: schema.description, deprecated: schema.deprecated });
            lines.push(...schemaDoc);
            const variants = (schema.oneOf || schema.anyOf)!;
            if (schema.discriminator) {
                // Discriminated union
                const discProp = schema.discriminator.propertyName;
                const mapping = schema.discriminator.mapping;
                const parts = variants.map((s) => {
                    const typeName = s.$ref ? refToName(s.$ref) : 'unknown';
                    let discValue: string | undefined;
                    if (mapping) {
                        // Find the key in mapping whose value matches this $ref
                        for (const [key, ref] of Object.entries(mapping)) {
                            if (s.$ref && ref === s.$ref) {
                                discValue = key;
                                break;
                            }
                        }
                    }
                    if (!discValue) {
                        // Fallback to schema name
                        discValue = typeName;
                    }
                    return `${typeName} & { ${discProp}: "${discValue}" }`;
                });
                lines.push(`export type ${name} = ${parts.join(' | ')};`);
            } else {
                const parts = variants.map(s => s.$ref ? refToName(s.$ref) : resolveType(s, allSchemas, 0));
                lines.push(`export type ${name} = ${parts.join(' | ')};`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}
