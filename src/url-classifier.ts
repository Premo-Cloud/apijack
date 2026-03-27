export interface ClassificationResult {
    safe: boolean;
    reason: string;
}

const SAFE_HOSTNAMES = new Set(['localhost']);
const SAFE_IPS = new Set(['127.0.0.1', '::1']);
const SAFE_SUFFIXES = ['.local', '.dev', '.test'];

export function classifyUrl(
    url: string,
    allowedCidrs?: string[],
): ClassificationResult {
    let hostname: string;
    try {
        const parsed = new URL(url);
        hostname = parsed.hostname;
    } catch {
        return { safe: false, reason: 'production' };
    }

    // Strip IPv6 brackets
    const cleanHost = hostname.replace(/^\[|\]$/g, '');

    // Check exact matches
    if (SAFE_HOSTNAMES.has(cleanHost)) {
        return { safe: true, reason: 'localhost' };
    }
    if (SAFE_IPS.has(cleanHost)) {
        return { safe: true, reason: cleanHost };
    }

    // Check safe suffixes
    for (const suffix of SAFE_SUFFIXES) {
        if (cleanHost.endsWith(suffix)) {
            return { safe: true, reason: suffix };
        }
    }

    // Check staging in hostname (as subdomain or path segment)
    if (cleanHost.includes('.staging.') || cleanHost.startsWith('staging.')) {
        return { safe: true, reason: 'staging' };
    }

    // Check CIDR allowlist (only for IP addresses)
    if (allowedCidrs && allowedCidrs.length > 0 && isIPv4(cleanHost)) {
        for (const cidr of allowedCidrs) {
            if (matchesCidr(cleanHost, cidr)) {
                return { safe: true, reason: `cidr:${cidr}` };
            }
        }
    }

    return { safe: false, reason: 'production' };
}

function isIPv4(host: string): boolean {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function matchesCidr(ip: string, cidr: string): boolean {
    const [network, bitsStr] = cidr.split('/');
    if (!network || !bitsStr) return false;
    const bits = parseInt(bitsStr, 10);
    if (bits < 0 || bits > 32) return false;

    const ipNum = ipToNumber(ip);
    const netNum = ipToNumber(network);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

    return (ipNum & mask) === (netNum & mask);
}

function ipToNumber(ip: string): number {
    const parts = ip.split('.');
    return (
        ((parseInt(parts[0]!) << 24)
            | (parseInt(parts[1]!) << 16)
            | (parseInt(parts[2]!) << 8)
            | parseInt(parts[3]!)) >>> 0
    );
}
