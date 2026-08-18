import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encrypt, decrypt } from '../../../utils/crypto.util';

@Injectable()
export class AiEncryptionService {
  private readonly encryptionKey: string;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.get<string>('ai.encryptionKey');
    if (!key || key.length !== 64) {
      throw new InternalServerErrorException(
        'AI_ENCRYPTION_KEY environment variable is not set or invalid. It must be a 64-character hex string.',
      );
    }
    this.encryptionKey = key;
  }

  /**
   * Encrypts a plaintext string.
   */
  encrypt(text: string): string {
    return encrypt(text, this.encryptionKey);
  }

  /**
   * Decrypts a ciphertext string.
   */
  decrypt(ciphertext: string): string {
    return decrypt(ciphertext, this.encryptionKey);
  }

  /**
   * Checks if the encryption key is properly configured.
   */
  isConfigured(): boolean {
    return !!this.encryptionKey && this.encryptionKey.length === 64;
  }
}
