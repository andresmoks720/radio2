import assert from 'node:assert/strict';
import { webcrypto, randomBytes } from 'node:crypto';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PBKDF2_ITERATIONS = 100000;
const FORMAT_VERSION = 1;

async function deriveKey(password, salt, usages) {
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function encryptMarkdown(markdown, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertextBuffer = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(markdown)
  );
  return {
    version: FORMAT_VERSION,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
  };
}

async function decryptPayload(payload, password) {
  if (payload.version !== FORMAT_VERSION) {
    throw new Error('Unsupported format version');
  }
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);
  const key = await deriveKey(password, salt, ['decrypt']);
  const plaintextBuffer = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return textDecoder.decode(plaintextBuffer);
}

function scorePassphrase(passphrase) {
  let score = 0;
  if (passphrase.length >= 8) score += 1;
  if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score += 1;
  if (/\d/.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;
  return score;
}

async function run() {
  console.log('Running encryption/decryption round-trip tests...');
  const payload = await encryptMarkdown('# Hello\n\nSecure content.', 'StrongPass!123');
  const plaintext = await decryptPayload(payload, 'StrongPass!123');
  assert.equal(plaintext.includes('Secure content.'), true);

  console.log('Running passphrase strength tests...');
  assert.equal(scorePassphrase('short'), 0);
  assert.equal(scorePassphrase('longerpass'), 1);
  assert.equal(scorePassphrase('LongerPass'), 2);
  assert.equal(scorePassphrase('LongerPass1'), 3);
  assert.equal(scorePassphrase('LongerPass1!'), 4);

  console.log('Running corrupted file handling tests...');
  const corrupted = { ...payload, ciphertext: payload.ciphertext.slice(0, -2) + 'ab' };
  let threw = false;
  try {
    await decryptPayload(corrupted, 'StrongPass!123');
  } catch (error) {
    threw = true;
  }
  assert.equal(threw, true);

  console.log('Running large file handling tests...');
  const largeContent = 'A'.repeat(10 * 1024 * 1024);
  const largePayload = await encryptMarkdown(largeContent, 'StrongPass!123');
  const decryptedLarge = await decryptPayload(largePayload, 'StrongPass!123');
  assert.equal(decryptedLarge.length, largeContent.length);

  console.log('Running performance benchmark...');
  const start = Date.now();
  await encryptMarkdown('Performance check', 'StrongPass!123');
  const duration = Date.now() - start;
  console.log(`Benchmark encrypt duration: ${duration}ms`);

  console.log('All automated tests passed.');
}

run();
