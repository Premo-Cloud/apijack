export const EXIT_SUCCESS = 0;
export const EXIT_API_ERROR = 1;
export const EXIT_AUTH_ERROR = 2;
export const EXIT_NETWORK_ERROR = 3;

export function handleApiError(status: number, body: string): never {
    const exitCode = status === 401 || status === 403 ? EXIT_AUTH_ERROR : EXIT_API_ERROR;

    try {
        const parsed = JSON.parse(body);
        process.stderr.write(`Error ${status}: ${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
        process.stderr.write(`Error ${status}: ${body}\n`);
    }

    process.exit(exitCode);
}

export function handleNetworkError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Network error: ${message}\n`);
    process.exit(EXIT_NETWORK_ERROR);
}
