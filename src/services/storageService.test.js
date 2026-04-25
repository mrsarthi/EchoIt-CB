import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localforage before importing storageService
vi.mock('localforage', () => {
    const stores = {};
    const createStore = (name) => {
        const data = {};
        return {
            setItem: vi.fn(async (key, val) => { data[key] = val; return val; }),
            getItem: vi.fn(async (key) => data[key] || null),
            removeItem: vi.fn(async (key) => { delete data[key]; }),
            clear: vi.fn(async () => { for (let k in data) delete data[k]; }),
            iterate: vi.fn(async (cb) => {
                for (let k in data) cb(data[k], k);
            }),
            keys: vi.fn(async () => Object.keys(data)),
        };
    };

    return {
        default: {
            createInstance: vi.fn((opts) => {
                const id = `${opts.name}_${opts.storeName}`;
                if (!stores[id]) stores[id] = createStore(id);
                return stores[id];
            })
        }
    };
});

import * as storage from '../src/services/storageService';

describe('Storage Service V2', () => {
    const chatId = '0x123';
    
    beforeEach(async () => {
        await storage.clearAllData();
    });

    it('should save a message to individual store (V2)', async () => {
        const msg = { id: 'm1', timestamp: 1000, content: 'hello' };
        await storage.saveMessage(chatId, msg);
        
        const history = await storage.getMessagesPaginated(chatId);
        expect(history).toHaveLength(1);
        expect(history[0].content).toBe('hello');
    });

    it('should support pagination (newest first)', async () => {
        await storage.saveMessage(chatId, { id: 'm1', timestamp: 1000, content: 'old' });
        await storage.saveMessage(chatId, { id: 'm2', timestamp: 2000, content: 'new' });
        
        // Default limit 50, but we test newest first
        const history = await storage.getMessagesPaginated(chatId, 1);
        expect(history).toHaveLength(1);
        expect(history[0].content).toBe('new');
    });

    it('should filter by beforeTimestamp', async () => {
        await storage.saveMessage(chatId, { id: 'm1', timestamp: 1000 });
        await storage.saveMessage(chatId, { id: 'm2', timestamp: 2000 });
        
        const history = await storage.getMessagesPaginated(chatId, 10, 2000);
        expect(history).toHaveLength(1);
        expect(history[0].id).toBe('m1');
    });

    it('should save and retrieve media', async () => {
        const data = 'base64-data';
        await storage.saveMedia('m1', data);
        const retrieved = await storage.getMedia('m1');
        expect(retrieved).toBe(data);
    });

    it('should set and get joinedAt', async () => {
        const ts = 123456789;
        await storage.setJoinedAt(ts);
        const retrieved = await storage.getJoinedAt();
        expect(retrieved).toBe(ts);
    });
});
