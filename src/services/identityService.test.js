import { describe, it, expect } from 'vitest';
import { generateDiscussionId, isDiscussionId } from '../src/services/identityService';

describe('Identity Service', () => {
    const wallet1 = '0x1234567890123456789012345678901234567890';
    const wallet2 = '0x0000000000000000000000000000000000000000';

    it('should generate deterministic IDs', () => {
        const id1a = generateDiscussionId(wallet1);
        const id1b = generateDiscussionId(wallet1);
        expect(id1a).toBe(id1b);
    });

    it('should generate unique IDs for different wallets', () => {
        const id1 = generateDiscussionId(wallet1);
        const id2 = generateDiscussionId(wallet2);
        expect(id1).not.toBe(id2);
    });

    it('should follow the WORD-WORD-NN format', () => {
        const id = generateDiscussionId(wallet1);
        expect(isDiscussionId(id)).toBe(true);
        // Regex check
        expect(id).toMatch(/^[A-Z]+-[A-Z]+-\d{1,2}$/);
    });

    it('should be case-insensitive for validation', () => {
        expect(isDiscussionId('COSMIC-PHOENIX-42')).toBe(true);
        expect(isDiscussionId('cosmic-phoenix-42')).toBe(true);
    });

    it('should reject invalid formats', () => {
        expect(isDiscussionId('INVALID')).toBe(false);
        expect(isDiscussionId('WORD-42')).toBe(false);
        expect(isDiscussionId('WORD-WORD-WORD')).toBe(false);
    });
});
