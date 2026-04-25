// Identity Service - Generates memorable "Discussion IDs" from wallet addresses
// Format: WORD-WORD-NN (e.g., GALAXY-WANDERER-88)

const ADJECTIVES = [
    'SWIFT', 'BRIGHT', 'COSMIC', 'SILENT', 'GOLDEN', 'MYSTIC', 'SHADOW', 'CRYSTAL',
    'NEON', 'LUNAR', 'SOLAR', 'FROST', 'EMBER', 'STORM', 'WILD', 'IRON',
    'AZURE', 'VIOLET', 'CORAL', 'SAGE', 'NOBLE', 'ROGUE', 'BRAVE', 'CALM',
    'DARK', 'DEEP', 'FERAL', 'GHOST', 'HYPER', 'IVORY', 'JADE', 'KEEN',
    'LUCID', 'MIST', 'NOVA', 'OMEGA', 'PIXEL', 'RAPID', 'SABLE', 'TITAN',
    'ULTRA', 'VIVID', 'WIRED', 'XENON', 'ZEAL', 'ALPHA', 'BLAZE', 'CYBER',
    'DELTA', 'ECHO', 'FLUX', 'GLOW', 'HAZE', 'IONIC', 'JEWEL', 'KNIGHTL',
    'LUMEN', 'MACRO', 'NEXUS', 'ONYX', 'PRISM', 'QUARTZ', 'RIFT', 'SONIC'
];

const NOUNS = [
    'WOLF', 'HAWK', 'PHOENIX', 'DRAGON', 'TIGER', 'FALCON', 'PANTHER', 'RAVEN',
    'VIPER', 'COBRA', 'SPARK', 'BLADE', 'COMET', 'ORBIT', 'PULSE', 'WAVE',
    'CREST', 'PEAK', 'FROST', 'FLAME', 'STONE', 'STEEL', 'DRIFT', 'SURGE',
    'ROVER', 'SCOUT', 'PILOT', 'RIDER', 'FORGE', 'VAULT', 'TOWER', 'GATE',
    'STAR', 'MOON', 'DAWN', 'DUSK', 'SHADE', 'LIGHT', 'STORM', 'BOLT',
    'ARROW', 'LANCE', 'SHIELD', 'CROWN', 'SAGE', 'MAGE', 'KNIGHT', 'MONK',
    'CIPHER', 'NODE', 'MATRIX', 'GRID', 'CORE', 'LINK', 'NEXUS', 'SHARD',
    'ATLAS', 'AEGIS', 'PRISM', 'APEX', 'ZENITH', 'VERTEX', 'HELIX', 'QUASAR'
];

/**
 * Simple hash function for generating deterministic indices from a string
 * @param {string} str 
 * @returns {number}
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

/**
 * Generate a memorable Discussion ID from a wallet address
 * Deterministic: same wallet always produces the same ID
 * Format: WORD-WORD-NN
 * @param {string} walletAddress - Ethereum wallet address (0x...)
 * @returns {string} Discussion ID (e.g., "COSMIC-PHOENIX-42")
 */
export function generateDiscussionId(walletAddress) {
    if (!walletAddress) return null;

    const normalized = walletAddress.toLowerCase();

    // Use different parts of the address for each component
    const hash1 = simpleHash(normalized.slice(0, 21));
    const hash2 = simpleHash(normalized.slice(21));
    const hash3 = simpleHash(normalized);

    const adjective = ADJECTIVES[hash1 % ADJECTIVES.length];
    const noun = NOUNS[hash2 % NOUNS.length];
    const number = (hash3 % 99) + 1; // 1-99

    return `${adjective}-${noun}-${number}`;
}

/**
 * Check if a string is a valid Discussion ID format
 * @param {string} query 
 * @returns {boolean}
 */
export function isDiscussionId(query) {
    if (!query) return false;
    // Match WORD-WORD-NN pattern (all caps, 1-2 digit number)
    return /^[A-Z]+-[A-Z]+-\d{1,2}$/i.test(query.trim().toUpperCase());
}

/**
 * Format a Discussion ID for display (ensure uppercase)
 * @param {string} id 
 * @returns {string}
 */
export function formatDiscussionId(id) {
    return id ? id.toUpperCase() : '';
}
