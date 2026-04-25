import { generateDiscussionId, isDiscussionId } from './src/services/identityService.js';

console.log('🧪 Testing Identity Service...');

const wallet1 = '0x1234567890123456789012345678901234567890';
const wallet2 = '0x0000000000000000000000000000000000000000';

const id1a = generateDiscussionId(wallet1);
const id1b = generateDiscussionId(wallet1);
const id2 = generateDiscussionId(wallet2);

console.log(`Wallet 1 -> ${id1a}`);
console.log(`Wallet 2 -> ${id2}`);

if (id1a === id1b) {
    console.log('✅ Determinism test passed: Same wallet produced same ID');
} else {
    console.log('❌ Determinism test failed!');
    process.exit(1);
}

if (id1a !== id2) {
    console.log('✅ Uniqueness test passed: Different wallets produced different IDs');
} else {
    console.log('❌ Uniqueness test failed!');
    process.exit(1);
}

if (isDiscussionId(id1a) && isDiscussionId(id2)) {
    console.log('✅ Format test passed: IDs match WORD-WORD-NN pattern');
} else {
    console.log('❌ Format test failed!');
    process.exit(1);
}

console.log('🎉 All identity tests passed!');
