export async function runCli(
    cliInvocation: string[],
    args: string[],
    cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn([...cliInvocation, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        ...(cwd ? { cwd } : {}),
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
}
