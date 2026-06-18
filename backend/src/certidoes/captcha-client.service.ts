import { Injectable, Logger } from '@nestjs/common';

const CAPTCHA_API_URL = process.env.CAPTCHA_API_URL ?? 'http://localhost:8000';
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY ?? 'dev-key';

interface CaptchaResponse {
  token: string;
  solver_used: string;
  confidence: number;
  paid: boolean;
  elapsed_ms: number;
}

/**
 * Cliente para a api_captcha local.
 * Tenta resolver localmente antes de acionar o 2captcha pago.
 * Se a api_captcha estiver offline, retorna null silenciosamente
 * para que o fallback pago seja acionado normalmente.
 */
@Injectable()
export class CaptchaClientService {
  private readonly logger = new Logger(CaptchaClientService.name);

  async resolverImagem(imageBase64: string): Promise<string | null> {
    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    return this.chamar({ type: 'image', image_b64: base64 });
  }

  async resolverHcaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
    return this.chamar({ type: 'hcaptcha', site_key: siteKey, page_url: pageUrl });
  }

  private async chamar(body: Record<string, string>): Promise<string | null> {
    try {
      const res = await fetch(`${CAPTCHA_API_URL}/solve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CAPTCHA_API_KEY,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        this.logger.warn(`api_captcha retornou ${res.status} — usando fallback pago.`);
        return null;
      }

      const data = (await res.json()) as CaptchaResponse;
      this.logger.log(
        `api_captcha: solver=${data.solver_used} confiança=${data.confidence.toFixed(2)} pago=${data.paid} em ${data.elapsed_ms}ms`,
      );

      return data.token || null;
    } catch (err) {
      this.logger.warn(`api_captcha offline ou erro (${err}) — usando fallback pago.`);
      return null;
    }
  }
}
