import * as readline from 'readline';

export function prompt(message: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer || defaultValue || '');
        });
    });
}

export function hiddenPrompt(message: string, defaultValue?: string): Promise<string> {
    process.stdout.write(message);

    return new Promise((resolve) => {
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        stdin.setRawMode(true);
        stdin.resume();

        // Enable bracketed paste mode so terminals wrap pastes in \x1b[200~ ... \x1b[201~
        process.stdout.write('\x1b[?2004h');

        let input = '';
        let pasting = false;
        let escBuf = '';

        const cleanup = () => {
            process.stdout.write('\x1b[?2004l'); // disable bracketed paste mode
            stdin.setRawMode(wasRaw);
            stdin.pause();
            stdin.removeListener('data', onData);
        };

        const onData = (buf: Buffer) => {
            const ch = buf.toString('utf8');

            for (let i = 0; i < ch.length; i++) {
                const c = ch[i];

                // Accumulate escape sequences
                if (escBuf.length > 0 || c === '\x1b') {
                    escBuf += c;
                    // Check for bracketed paste start: \x1b[200~
                    if (escBuf === '\x1b[200~') {
                        pasting = true;
                        escBuf = '';
                        continue;
                    }
                    // Check for bracketed paste end: \x1b[201~
                    if (escBuf === '\x1b[201~') {
                        pasting = false;
                        escBuf = '';
                        continue;
                    }
                    // Still accumulating — wait for more chars (max 6 for bracketed paste)
                    if (escBuf.length < 6 && escBuf.startsWith('\x1b')) continue;
                    // Not a recognized sequence — discard
                    escBuf = '';
                    continue;
                }

                if (c === '\r' || c === '\n') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve(input || defaultValue || '');
                    return;
                } else if (c === '\x7f' || c === '\b') {
                    input = input.slice(0, -1);
                } else if (c === '\x03') {
                    cleanup();
                    process.stdout.write('\n');
                    process.exit(2);
                } else if (c! >= ' ') {
                    input += c;
                }
            }
        };

        stdin.on('data', onData);
    });
}
