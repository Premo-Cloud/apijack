import { describe, test, expect } from 'bun:test';
import { classifyUrl } from '../src/url-classifier';

describe('classifyUrl()', () => {
    describe('safe URLs', () => {
        test('localhost is safe', () => {
            expect(classifyUrl('http://localhost:8080').safe).toBe(true);
        });

        test('127.0.0.1 is safe', () => {
            expect(classifyUrl('http://127.0.0.1:3000').safe).toBe(true);
        });

        test('::1 is safe', () => {
            expect(classifyUrl('http://[::1]:8080').safe).toBe(true);
        });

        test('.local hostname is safe', () => {
            expect(classifyUrl('http://myserver.local:8080').safe).toBe(true);
        });

        test('.dev hostname is production (real TLD)', () => {
            expect(classifyUrl('http://api.dev:3000').safe).toBe(false);
        });

        test('.test hostname is safe', () => {
            expect(classifyUrl('http://api.test').safe).toBe(true);
        });

        test('.staging. in hostname is safe', () => {
            expect(classifyUrl('https://api.staging.example.com').safe).toBe(true);
        });

        test('staging. at start of hostname is safe', () => {
            expect(classifyUrl('https://staging.example.com').safe).toBe(true);
        });

        test('includes reason for safe classification', () => {
            const result = classifyUrl('http://localhost:8080');
            expect(result.reason).toBe('localhost');
        });
    });

    describe('production URLs', () => {
        test('public domain is production', () => {
            const result = classifyUrl('https://api.example.com');
            expect(result.safe).toBe(false);
            expect(result.reason).toBe('production');
        });

        test('public IP is production', () => {
            expect(classifyUrl('http://54.231.10.5:8080').safe).toBe(false);
        });

        test('quickbooks API is production', () => {
            expect(classifyUrl('https://quickbooks.api.intuit.com').safe).toBe(false);
        });
    });

    describe('CIDR allowlist', () => {
        test('IP in allowed CIDR is safe', () => {
            const result = classifyUrl('http://192.168.1.50:8080', ['192.168.1.0/24']);
            expect(result.safe).toBe(true);
            expect(result.reason).toBe('cidr:192.168.1.0/24');
        });

        test('IP outside allowed CIDR is production', () => {
            const result = classifyUrl('http://192.168.2.50:8080', ['192.168.1.0/24']);
            expect(result.safe).toBe(false);
        });

        test('IP in broad CIDR is safe', () => {
            const result = classifyUrl('http://10.50.100.200:8080', ['10.0.0.0/8']);
            expect(result.safe).toBe(true);
        });

        test('multiple CIDRs checked', () => {
            const cidrs = ['192.168.0.0/16', '10.0.0.0/8'];
            expect(classifyUrl('http://10.1.2.3', cidrs).safe).toBe(true);
            expect(classifyUrl('http://192.168.5.5', cidrs).safe).toBe(true);
            expect(classifyUrl('http://172.16.0.1', cidrs).safe).toBe(false);
        });

        test('hostname (not IP) is not matched against CIDRs', () => {
            const result = classifyUrl('https://api.example.com', ['10.0.0.0/8']);
            expect(result.safe).toBe(false);
        });
    });

    describe('edge cases', () => {
        test('URL without port', () => {
            expect(classifyUrl('http://localhost').safe).toBe(true);
        });

        test('URL with path', () => {
            expect(classifyUrl('http://localhost:8080/api/v1').safe).toBe(true);
        });

        test('HTTPS localhost is safe', () => {
            expect(classifyUrl('https://localhost:443').safe).toBe(true);
        });

        test('empty CIDR list behaves like no CIDRs', () => {
            expect(classifyUrl('http://10.0.0.1', []).safe).toBe(false);
        });
    });
});
