export interface OpenApiSchema {
    // Structure
    type?: string | string[];  // OAS 3.1: array for multi-type/nullable
    properties?: Record<string, OpenApiSchema>;
    items?: OpenApiSchema | boolean;  // OAS 3.1: boolean (with prefixItems)
    $ref?: string;
    allOf?: OpenApiSchema[];
    oneOf?: OpenApiSchema[];
    anyOf?: OpenApiSchema[];
    not?: OpenApiSchema;  // OAS 3.1: negation
    additionalProperties?: boolean | OpenApiSchema;
    prefixItems?: OpenApiSchema[];  // OAS 3.1: tuple types
    patternProperties?: Record<string, OpenApiSchema>;  // OAS 3.1: regex-keyed properties
    $defs?: Record<string, OpenApiSchema>;  // OAS 3.1: local definitions

    // Enum + nullable
    enum?: (string | number | boolean | null)[];  // OAS 3.1: widened from string[]
    const?: unknown;  // OAS 3.1: literal value
    nullable?: boolean;

    // Metadata
    description?: string;
    title?: string;
    format?: string;
    example?: unknown;
    default?: unknown;
    deprecated?: boolean;
    readOnly?: boolean;
    writeOnly?: boolean;

    // Constraints
    required?: string[];
    minimum?: number;
    maximum?: number;
    exclusiveMinimum?: number | boolean;
    exclusiveMaximum?: number | boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    minItems?: number;
    maxItems?: number;
    uniqueItems?: boolean;
    multipleOf?: number;  // OAS 3.0 keyword (previously missing)
    minProperties?: number;  // OAS 3.0 keyword (previously missing)
    maxProperties?: number;  // OAS 3.0 keyword (previously missing)

    // Polymorphism
    discriminator?: { propertyName: string; mapping?: Record<string, string> };
}

export interface OpenApiOperation {
    tags?: string[];
    operationId?: string;
    summary?: string;
    description?: string;
    deprecated?: boolean;
    parameters?: Array<{
        name: string;
        in: 'path' | 'query' | 'header' | 'cookie';  // OAS 3.1: cookie
        required?: boolean;
        description?: string;
        schema: OpenApiSchema;
        deprecated?: boolean;
        example?: unknown;
        style?: string;  // OAS 3.1: serialization style
        explode?: boolean;  // OAS 3.1: explode arrays/objects
    }>;
    requestBody?: {
        description?: string;
        required?: boolean;
        content?: Record<string, { schema: OpenApiSchema }>;
    };
    responses?: Record<
        string,
        {
            description?: string;
            content?: Record<string, { schema: OpenApiSchema }>;
        }
    >;
}

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

export const HTTP_METHODS: HttpMethod[] = [
    'get',
    'post',
    'put',
    'delete',
    'patch',
];

export interface BodyProp {
    name: string;
    type: string;
    cliFlag: string; // kebab-case for CLI, e.g. "first-name"
    camelName: string; // camelCase for Commander opts, e.g. "firstName"
    enumValues?: (string | number | boolean | null)[];
    variant?: string; // which discriminator variant this belongs to (undefined = common/base)
    description?: string;
    required?: boolean;
    format?: string;
    default?: unknown;
    deprecated?: boolean;
    readOnly?: boolean;
}

export interface CommandDef {
    verb: string;
    operationId: string;
    pathParams: Array<{ name: string; type: string; description?: string }>;
    queryParams: Array<{
        name: string;
        type: string;
        enumValues?: (string | number | boolean | null)[];
        description?: string;
        default?: unknown;
        format?: string;
        style?: string;
    }>;
    hasBody: boolean;
    bodyIsArray: boolean;
    bodyProps: BodyProp[];
    bodyPrimitiveType?:
        | 'string'
        | 'number'
        | 'boolean'
        | 'string[]'
        | 'number[]';
    description: string;
    summary?: string;
    deprecated?: boolean;
}
