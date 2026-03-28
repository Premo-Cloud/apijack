import { z } from 'zod';

export interface McpContext {
    cliName: string;
    cliInvocation: string[];
    generatedDir: string;
    routinesDir: string;
    projectRoot?: string;
    configPath?: string;
    allowedCidrs?: string[];
}

export interface ToolResult {
    [key: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

export function defineTool<S extends z.ZodRawShape>(def: {
    name: string;
    description: string;
    schema: S;
    handler: (params: z.infer<z.ZodObject<S>>, ctx: McpContext) => Promise<ToolResult>;
}) {
    return def;
}
