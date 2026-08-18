import * as crypto from 'crypto';

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * The key must be a 64-character hex string (32 bytes).
 * Output format (base64): [12-byte IV][16-byte authTag][ciphertext]
 */
export function encrypt(text: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a ciphertext string encrypted by the encrypt() function.
 * The key must be the same 64-character hex string used during encryption.
 */
export function decrypt(ciphertext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Verifies an HMAC-SHA256 webhook signature.
 * @param payload - Raw request body as string
 * @param signature - Signature from the request header
 * @param secret - Shared webhook secret
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const computed = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(signature.replace(/^sha256=/, ''), 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Generates a random API key
 */
export function generateApiKey(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash a string with SHA256
 */
export function sha256Hash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}
