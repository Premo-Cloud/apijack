import type { ToolResult } from '../types';

export function textResult(text: string, isError?: boolean): ToolResult {
    return {
        content: [{ type: 'text', text }],
        ...(isError ? { isError: true } : {}),
    };
}
