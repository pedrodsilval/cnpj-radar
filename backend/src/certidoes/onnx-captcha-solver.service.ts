import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { join } from 'path';
import * as ort from 'onnxruntime-node';
import { Jimp } from 'jimp';

// Mesmo charset/dimensoes de models/captcha_meta.json na api_captcha --
// precisam ficar em sincronia se o modelo for retreinado com outro tamanho.
const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CAPTCHA_LENGTH = 6;
const IMG_H = 32;
const IMG_W = 128;
const CTC_BLANK = CHARSET.length;

const MODEL_PATH = join(process.cwd(), 'assets', 'captcha_cnn.onnx');

export interface OnnxSolveResult {
  token: string;
  confidence: number;
}

/**
 * Roda o modelo CRNN treinado direto no processo do cnpj-radar (ONNX Runtime),
 * sem chamada HTTP pra api_captcha. Elimina a latencia de rede + cold start
 * do Render que medimos custar 4-8s numa chamada real -- tempo suficiente
 * pro captcha do TST expirar no servidor antes da resposta ser submetida.
 * Se o modelo nao carregar por qualquer motivo, resolverImagem() retorna
 * null e quem chama cai pro fallback (api_captcha via HTTP, depois 2captcha).
 */
@Injectable()
export class OnnxCaptchaSolverService implements OnModuleInit {
  private readonly logger = new Logger(OnnxCaptchaSolverService.name);
  private session: ort.InferenceSession | null = null;

  async onModuleInit() {
    try {
      this.session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['cpu'],
      });
      this.logger.log('Modelo ONNX do captcha CNDT carregado (inferencia local, sem rede).');
    } catch (err) {
      this.logger.warn(`Não foi possível carregar o modelo ONNX local (${err}) — usando fallback via api_captcha/2captcha.`);
    }
  }

  async resolverImagem(imageSrc: string): Promise<OnnxSolveResult | null> {
    if (!this.session) return null;

    const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '').trim();
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }

    let img;
    try {
      img = await Jimp.read(buffer);
    } catch (err) {
      this.logger.warn(`ONNX local: falha ao decodificar imagem (${err}).`);
      return null;
    }

    img.greyscale();
    img.resize({ w: IMG_W, h: IMG_H });

    const { data } = img.bitmap; // RGBA
    const tensorData = new Float32Array(IMG_H * IMG_W);
    for (let i = 0; i < IMG_H * IMG_W; i++) {
      // Normalizacao igual ao treino: (pixel/255 - 0.5) / 0.5
      tensorData[i] = data[i * 4] / 127.5 - 1.0;
    }

    const inputTensor = new ort.Tensor('float32', tensorData, [1, 1, IMG_H, IMG_W]);

    let results: ort.InferenceSession.OnnxValueMapType;
    try {
      results = await this.session.run({ image: inputTensor });
    } catch (err) {
      this.logger.warn(`ONNX local: erro na inferência (${err}).`);
      return null;
    }

    const logits = results['logits'];
    const dims = logits.dims as number[]; // [W, 1, numClasses]
    const W = dims[0];
    const numClasses = dims[2];
    const logitsData = logits.data as Float32Array;

    let anterior: number | null = null;
    const chars: string[] = [];
    const confs: number[] = [];

    for (let t = 0; t < W; t++) {
      const offset = t * numClasses; // batch=1
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let c = 0; c < numClasses; c++) {
        const v = logitsData[offset + c];
        if (v > maxVal) {
          maxVal = v;
          maxIdx = c;
        }
      }
      // Softmax da classe vencedora: exp(0) / soma(exp(logit_j - maxVal))
      let sumExp = 0;
      for (let c = 0; c < numClasses; c++) {
        sumExp += Math.exp(logitsData[offset + c] - maxVal);
      }
      const prob = 1 / sumExp;

      if (maxIdx !== anterior && maxIdx !== CTC_BLANK) {
        chars.push(CHARSET[maxIdx]);
        confs.push(prob);
      }
      anterior = maxIdx;
    }

    const token = chars.join('');
    // CAPTCHA é tudo-ou-nada: confiança é o mínimo entre os caracteres (o elo
    // mais fraco), igual à api_captcha (solvers/ml_solver.py) — não a média,
    // que mascararia um caractere incerto.
    if (token.length !== CAPTCHA_LENGTH) {
      return { token, confidence: 0 };
    }
    return { token, confidence: Math.min(...confs) };
  }
}
