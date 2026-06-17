import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

// Chave fixa de desenvolvimento — nunca usar em produção
const DEV_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

@Injectable()
export class CredenciaisCriptService {
  private readonly key: Buffer;
  private readonly logger = new Logger(CredenciaisCriptService.name);

  constructor() {
    const hex = process.env.ENCRYPTION_KEY;
    if (!hex) {
      if (process.env.APP_ENV === 'production') {
        throw new Error('ENCRYPTION_KEY não definida. Em produção é obrigatória (64 hex chars = 32 bytes).');
      }
      this.logger.warn(
        'ENCRYPTION_KEY não configurada — usando chave de desenvolvimento. NÃO use em produção.',
      );
      this.key = Buffer.from(DEV_KEY, 'hex');
    } else {
      if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
        throw new Error('ENCRYPTION_KEY deve ter exatamente 64 caracteres hexadecimais (32 bytes).');
      }
      this.key = Buffer.from(hex, 'hex');
    }
  }

  encrypt(plaintext: string): { valor: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      valor: encrypted.toString('base64'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  decrypt(valor: string, iv: string, tag: string): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(valor, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
