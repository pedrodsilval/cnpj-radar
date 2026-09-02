import { Injectable, Logger } from '@nestjs/common';
import { OnnxCaptchaSolverService } from './onnx-captcha-solver.service';

// Sem CAPTCHA_API_URL configurada, não há para onde chamar — o default
// (localhost:8000) só faz sentido em dev local, nunca em produção (aponta
// pro próprio container do Render, onde nada escuta nessa porta). Chamar
// mesmo assim significa esperar o timeout inteiro (120s) sem chance de
// sucesso, em cada uma das 3 tentativas de cada certidão que usa captcha.
const CAPTCHA_API_URL = process.env.CAPTCHA_API_URL ?? null;
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY ?? 'dev-key';

// Mesmo limiar da api_captcha (ML_CONFIDENCE_THRESHOLD): abaixo disso não
// confia no palpite local, cai pro próximo solver.
const ONNX_CONFIDENCE_THRESHOLD = 0.9;

interface CaptchaResponse {
  token: string;
  solver_used: string;
  confidence: number;
  paid: boolean;
  elapsed_ms: number;
}

/**
 * Cliente para resolução de CAPTCHA de imagem: tenta o modelo ONNX local
 * (mesmo processo, sem rede — resolve em milissegundos) antes de cair pra
 * api_captcha via HTTP e depois pro 2captcha pago. A chamada em rede pra
 * api_captcha, mesmo bem-sucedida, mede 4-8s de captura-até-submissão em
 * produção (rede + cold start do Render) — tempo suficiente pro captcha do
 * CNDT/TST expirar no servidor antes da resposta chegar, mesmo estando
 * certa. O caminho ONNX local elimina essa janela quase por completo.
 */
@Injectable()
export class CaptchaClientService {
  private readonly logger = new Logger(CaptchaClientService.name);

  constructor(private readonly onnxSolver: OnnxCaptchaSolverService) {}

  async resolverImagem(imageBase64: string): Promise<string | null> {
    const local = await this.onnxSolver.resolverImagem(imageBase64);
    if (local && local.confidence >= ONNX_CONFIDENCE_THRESHOLD) {
      this.logger.log(`ONNX local: resposta "${local.token}" confiança=${local.confidence.toFixed(2)} (sem rede).`);
      return local.token;
    }
    if (local) {
      this.logger.log(`ONNX local: confiança baixa (${local.confidence.toFixed(2)}) — tentando api_captcha/2captcha.`);
    }

    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    return this.chamar({ type: 'image', image_b64: base64 });
  }

  async resolverHcaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
    return this.chamar({ type: 'hcaptcha', site_key: siteKey, page_url: pageUrl });
  }

  private async chamar(body: Record<string, string>): Promise<string | null> {
    if (!CAPTCHA_API_URL) return null;

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
        const corpo = await res.text().catch(() => '');
        this.logger.warn(`api_captcha retornou ${res.status} — usando fallback pago. Corpo: ${corpo}`);
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
