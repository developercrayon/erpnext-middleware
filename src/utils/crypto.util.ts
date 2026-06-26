import * as crypto from 'crypto';

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
