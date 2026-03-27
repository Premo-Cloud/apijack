import type { OpenApiSchema, BodyProp } from './openapi-types';

/**
 * Resolve an OpenAPI schema to a TypeScript type string.
 * Handles $ref, arrays, primitives, enums, objects, allOf, oneOf, anyOf,
 * inline object literals (up to depth 3), nullable, and OAS 3.1 features
 * (const, type arrays, prefixItems, not, patternProperties).
 */
export function resolveType(
    schema: OpenApiSchema,
    schemas: Record<string, OpenApiSchema> = {},
    depth: number = 0,
    visited: Set<string> = new Set(),
): string {
    let base: string;

    // OAS 3.1: const — literal value
    if (schema.const !== undefined) {
        if (typeof schema.const === 'string') return `"${schema.const}"`;
        if (schema.const === null) return 'null';
        return String(schema.const);
    }

    // OAS 3.1: enum with non-string types (integer enums, mixed enums, type-array enums)
    if (schema.enum && schema.type !== 'string') {
        base = schema.enum.map((v) => {
            if (v === null) return 'null';
            if (typeof v === 'string') return `"${v}"`;
            return String(v);
        }).join(' | ');
        if (schema.nullable) base += ' | null';
        return base;
    }

    // OAS 3.1: type as array (e.g. ["string", "null"])
    if (Array.isArray(schema.type)) {
        const nonNull = schema.type.filter((t: string) => t !== 'null');
        const isNullable = schema.type.includes('null');
        let resolved: string;
        if (nonNull.length === 0) {
            resolved = 'null';
        } else if (nonNull.length === 1) {
            resolved = resolveType({ ...schema, type: nonNull[0], nullable: undefined }, schemas, depth, visited);
        } else {
            resolved = nonNull.map((t: string) =>
                resolveType({ ...schema, type: t, nullable: undefined, enum: undefined }, schemas, depth, visited),
            ).join(' | ');
        }
        if (isNullable && !resolved.includes('null')) {
            resolved += ' | null';
        }
        return resolved;
    }

    // OAS 3.1: prefixItems — tuple types
    if (schema.prefixItems) {
        const tupleTypes = schema.prefixItems.map(s => resolveType(s, schemas, depth, visited));
        if (schema.items && typeof schema.items === 'object') {
            const restType = resolveType(schema.items as OpenApiSchema, schemas, depth, visited);
            base = `[${tupleTypes.join(', ')}, ...${restType}[]]`;
        } else {
            base = `[${tupleTypes.join(', ')}]`;
        }
        if (schema.nullable) base += ' | null';
        return base;
    }

    // OAS 3.1: not — negation (no other type info)
    if (schema.not && !schema.type && !schema.properties && !schema.$ref && !schema.allOf && !schema.oneOf && !schema.anyOf && !schema.enum && schema.const === undefined) {
        base = 'unknown';
        if (schema.nullable) base += ' | null';
        return base;
    }

    if (schema.$ref) {
        base = refToName(schema.$ref);
    } else if (schema.allOf) {
        const parts = schema.allOf.map((s) => {
            if (s.$ref) return refToName(s.$ref);
            if (s.properties) return resolveType(s, schemas, depth, visited);
            return 'unknown';
        });
        base = parts.join(' & ');
    } else if (schema.oneOf || schema.anyOf) {
        const variants = (schema.oneOf || schema.anyOf)!;
        const parts = variants.map(s => resolveType(s, schemas, depth, visited));
        base = parts.join(' | ');
    } else if (schema.type === 'array' && schema.items) {
        const itemType = typeof schema.items === 'boolean' ? 'unknown' : resolveType(schema.items, schemas, depth, visited);
        // Wrap union/intersection types in parens for array
        if (itemType.includes(' | ') || itemType.includes(' & ')) {
            base = `(${itemType})[]`;
        } else {
            base = `${itemType}[]`;
        }
    } else if (schema.type === 'integer' || schema.type === 'number') {
        base = 'number';
    } else if (schema.type === 'boolean') {
        base = 'boolean';
    } else if (schema.type === 'string') {
        if (schema.enum) {
            base = schema.enum.map((v) => {
                if (v === null) return 'null';
                if (typeof v === 'string') return `"${v}"`;
                return String(v);
            }).join(' | ');
        } else {
            base = 'string';
        }
    } else if ((schema.type === 'object' || schema.properties) && schema.properties) {
        if (depth < 3) {
            // Emit inline object literal type
            const innerLines: string[] = ['{'];
            const requiredSet = new Set(schema.required || []);
            for (const [propName, propSchema] of Object.entries(schema.properties)) {
                const propDoc = buildJsDoc(propSchema, '  ');
                innerLines.push(...propDoc);
                const tsType = resolveType(propSchema, schemas, depth + 1, visited);
                const optional = requiredSet.has(propName) ? '' : '?';
                innerLines.push(`  ${propName}${optional}: ${tsType};`);
            }
            // patternProperties inside inline objects
            if (schema.patternProperties) {
                const patternTypes: string[] = [];
                for (const [pattern, patternSchema] of Object.entries(schema.patternProperties)) {
                    const patType = resolveType(patternSchema, schemas, depth + 1, visited);
                    innerLines.push(`  /** Properties matching pattern: ${pattern} */`);
                    patternTypes.push(patType);
                }
                if (patternTypes.length > 0 && !schema.additionalProperties) {
                    const unionType = [...new Set(patternTypes)].join(' | ');
                    innerLines.push(`  [key: string]: ${unionType} | undefined;`);
                }
            }
            // additionalProperties inside inline objects
            if (schema.additionalProperties && schema.additionalProperties !== true) {
                const addType = resolveType(schema.additionalProperties, schemas, depth + 1, visited);
                innerLines.push(`  [key: string]: ${addType} | undefined;`);
            } else if (schema.additionalProperties === true) {
                innerLines.push('  [key: string]: unknown;');
            }
            innerLines.push('}');
            base = innerLines.join('\n');
        } else {
            base = 'Record<string, unknown>';
        }
    } else if (schema.type === 'object') {
        base = 'Record<string, unknown>';
    } else {
        base = 'unknown';
    }

    if (schema.nullable) {
        base += ' | null';
    }

    return base;
}

/**
 * Extract the type name from a JSON $ref string.
 * e.g. "#/components/schemas/Foo" -> "Foo"
 */
export function refToName(ref: string): string {
    return ref.split('/').pop()!;
}

/**
 * Map an OpenAPI schema to a simple TypeScript type for use in method signatures.
 * Less detailed than resolveType — only handles top-level primitives and $ref.
 */
export function schemaToTsType(schema: OpenApiSchema): string {
    if (schema.type === 'integer' || schema.type === 'number') return 'number';
    if (schema.type === 'boolean') return 'boolean';
    if (schema.type === 'string') return 'string';
    if (schema.$ref) return refToName(schema.$ref);
    return 'unknown';
}

/**
 * Normalize an OpenAPI tag into an array of lowercase tokens.
 * Splits on whitespace, slashes, and colons. Strips leading/trailing hyphens.
 */
export function normalizeTag(tag: string): string[] {
    return tag
        .toLowerCase()
        .split(/[\s/:]+/)
        .map(t => t.replace(/^-+|-+$/g, ''))
        .filter(Boolean);
}

/**
 * Build JSDoc comment lines from OpenAPI schema metadata.
 * Returns an array of comment lines (including delimiters) or empty array if no metadata.
 */
export function buildJsDoc(
    schema: Partial<OpenApiSchema>,
    indent: string = '',
): string[] {
    const tags: string[] = [];

    // Collect tags in specified order
    if (schema.format !== undefined) tags.push(`@format ${schema.format}`);
    if (schema.minimum !== undefined) tags.push(`@minimum ${schema.minimum}`);
    if (schema.maximum !== undefined) tags.push(`@maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && schema.exclusiveMinimum !== false) {
        tags.push(`@exclusiveMinimum ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && schema.exclusiveMaximum !== false) {
        tags.push(`@exclusiveMaximum ${schema.exclusiveMaximum}`);
    }
    if (schema.minLength !== undefined) tags.push(`@minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined) tags.push(`@maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined) tags.push(`@pattern ${schema.pattern}`);
    if (schema.minItems !== undefined) tags.push(`@minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined) tags.push(`@maxItems ${schema.maxItems}`);
    if (schema.uniqueItems === true) tags.push('@uniqueItems');
    if (schema.multipleOf !== undefined) tags.push(`@multipleOf ${schema.multipleOf}`);
    if (schema.minProperties !== undefined) tags.push(`@minProperties ${schema.minProperties}`);
    if (schema.maxProperties !== undefined) tags.push(`@maxProperties ${schema.maxProperties}`);
    if (schema.default !== undefined) {
        if (typeof schema.default === 'object' && schema.default !== null) {
            tags.push(`@default ${JSON.stringify(schema.default)}`);
        } else {
            tags.push(`@default ${schema.default}`);
        }
    }
    if (schema.example !== undefined) {
        if (typeof schema.example === 'string') {
            tags.push(`@example "${schema.example}"`);
        } else if (typeof schema.example === 'object' && schema.example !== null) {
            tags.push(`@example ${JSON.stringify(schema.example)}`);
        } else {
            tags.push(`@example ${schema.example}`);
        }
    }
    if (schema.readOnly === true) tags.push('@readonly');
    if (schema.writeOnly === true) tags.push('@writeonly');
    // OAS 3.1: not — negation annotation
    if (schema.not) {
        const notSchema = schema.not as OpenApiSchema;
        const notDesc = notSchema.type ? `type: ${notSchema.type}` : JSON.stringify(schema.not);
        tags.push(`@not ${notDesc}`);
    }

    // Handle description, escaping */ sequences (but not the final closing */)
    let desc = schema.description;
    if (desc) {
        desc = desc.replace(/\*\//g, '*\\/');
    }

    const isDeprecated = schema.deprecated === true;

    // Determine if there is anything to emit
    if (!desc && !isDeprecated && tags.length === 0) {
        return [];
    }

    // Build content lines (description lines + tag lines)
    const contentLines: string[] = [];

    if (isDeprecated) {
    // @deprecated goes first, incorporating description
        if (desc) {
            contentLines.push(`@deprecated ${desc}`);
        } else {
            contentLines.push('@deprecated');
        }
    } else if (desc) {
    // Split multi-line descriptions into separate lines
        const descLines = desc.split('\n');
        contentLines.push(...descLines);
    }

    // Add tag lines
    contentLines.push(...tags);

    if (contentLines.length === 0) {
        return [];
    }

    // Single content line -> single-line JSDoc
    if (contentLines.length === 1) {
        return [`${indent}/** ${contentLines[0]} */`];
    }

    // Multi-line JSDoc
    const result: string[] = [];
    result.push(`${indent}/** ${contentLines[0]}`);
    for (let i = 1; i < contentLines.length; i++) {
        if (i === contentLines.length - 1) {
            result.push(`${indent} * ${contentLines[i]} */`);
        } else {
            result.push(`${indent} * ${contentLines[i]}`);
        }
    }

    return result;
}

/**
 * Resolve response type from OpenAPI operation responses.
 * Scans 200/201/202/204 responses for JSON schema and returns the TypeScript type.
 */
export function resolveResponseType(
    responses: Record<string, { description?: string; content?: Record<string, { schema: OpenApiSchema }> }>,
    schemas: Record<string, OpenApiSchema>,
): string {
    for (const status of ['200', '201', '202', '204']) {
        const response = responses[status];
        if (!response) continue;
        const jsonSchema = response.content?.['application/json']?.schema;
        if (!jsonSchema) continue;
        return resolveType(jsonSchema, schemas);
    }
    return 'void';
}

/**
 * Resolve an OpenAPI request body schema into a flat list of BodyProp entries
 * suitable for generating CLI flags. Handles $ref, allOf, oneOf/anyOf, and arrays.
 * Skips readOnly properties and tracks required fields.
 */
export function resolveSchemaProps(
    schema: OpenApiSchema | undefined,
    schemas: Record<string, OpenApiSchema>,
    parentRequired?: Set<string>,
): BodyProp[] {
    if (!schema) return [];

    // Resolve $ref
    if (schema.$ref) {
        const name = schema.$ref.split('/').pop()!;
        const refSchema = schemas[name];
        return resolveSchemaProps(refSchema, schemas, parentRequired);
    }

    // Resolve allOf — merge properties from all parts
    if (schema.allOf) {
        const merged: BodyProp[] = [];
        const seen = new Set<string>();
        const mergedRequired = new Set<string>(parentRequired || []);
        for (const part of schema.allOf) {
            if (part.required) part.required.forEach(r => mergedRequired.add(r));
            if (part.$ref) {
                const refName = part.$ref.split('/').pop()!;
                const refSchema = schemas[refName];
                if (refSchema?.required) refSchema.required.forEach(r => mergedRequired.add(r));
            }
        }
        for (const part of schema.allOf) {
            for (const prop of resolveSchemaProps(part, schemas, mergedRequired)) {
                if (!seen.has(prop.name) && !seen.has(prop.cliFlag)) {
                    seen.add(prop.name);
                    seen.add(prop.cliFlag);
                    merged.push(prop);
                }
            }
        }
        return merged;
    }

    // Resolve oneOf/anyOf — collect all variant properties tagged with variant name
    if (schema.oneOf || schema.anyOf) {
        const variants = (schema.oneOf || schema.anyOf)!;
        if (variants.length === 1) {
            return resolveSchemaProps(variants[0], schemas, parentRequired);
        }

        const all: BodyProp[] = [];
        const seen = new Set<string>();

        for (const v of variants) {
            const variantName = v.$ref ? v.$ref.split('/').pop()! : undefined;
            const props = resolveSchemaProps(v, schemas, parentRequired);
            for (const prop of props) {
                if (!seen.has(prop.cliFlag)) {
                    seen.add(prop.cliFlag);
                    all.push({ ...prop, variant: variantName });
                }
            }
        }
        return all;
    }

    // Unwrap arrays — expose the item properties
    if (schema.type === 'array' && schema.items && typeof schema.items !== 'boolean') {
        return resolveSchemaProps(schema.items, schemas, parentRequired);
    }

    if (!schema.properties) return [];

    const requiredSet = new Set([
        ...(parentRequired || []),
        ...(schema.required || []),
    ]);

    const results: BodyProp[] = [];
    const seenFlags = new Set<string>();
    for (const [name, prop] of Object.entries(schema.properties)) {
    // Skip readOnly properties — server-generated, shouldn't be CLI flags
        if (prop.readOnly) continue;

        const flag = name
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '');
        if (seenFlags.has(flag)) continue; // Skip duplicate CLI flags
        seenFlags.add(flag);

        // Resolve enum values — direct or via $ref
        let enumValues: (string | number | boolean | null)[] | undefined;
        if (prop.enum) {
            enumValues = prop.enum;
        } else if (prop.$ref) {
            const refName = prop.$ref.split('/').pop()!;
            const refSchema = schemas[refName];
            if (refSchema?.enum) enumValues = refSchema.enum;
        }

        let description = prop.description;
        if (!description && prop.$ref) {
            const refName = prop.$ref.split('/').pop()!;
            const refSchema = schemas[refName];
            if (refSchema?.description) description = refSchema.description;
        }

        results.push({
            name,
            type: schemaToTsType(prop),
            cliFlag: flag,
            camelName: name,
            enumValues,
            description,
            required: requiredSet.has(name),
            format: prop.format,
            default: prop.default,
            deprecated: prop.deprecated,
            readOnly: prop.readOnly,
        });
    }
    return results;
}

/**
 * Replace non-alphanumeric characters with underscores for safe variable names.
 */
export function sanitizeVar(name: string): string {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Capitalize the first character of a string.
 */
export function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
