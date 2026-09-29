import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { chromium } from 'playwright';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Certidao, CERTIDAO_LABELS, CertidaoStatus } from '../database/entities/certidao.entity';
import { sanitizeCnpj } from '../common/utils/cnpj.util';

const STATUS_LABEL: Record<CertidaoStatus, string> = {
  [CertidaoStatus.REGULAR]: 'Regular',
  [CertidaoStatus.IRREGULAR]: 'Irregular',
  [CertidaoStatus.INDISPONIVEL]: 'Indisponível',
  [CertidaoStatus.NAO_CONSULTADA]: 'Não consultada',
  [CertidaoStatus.CONSULTA_MANUAL]: 'Consulta manual',
  [CertidaoStatus.EXIGE_CERTIFICADO]: 'Exige certificado',
};

const STATUS_COR: Record<CertidaoStatus, string> = {
  [CertidaoStatus.REGULAR]: '#2f6b3e',
  [CertidaoStatus.IRREGULAR]: '#a13d3d',
  [CertidaoStatus.INDISPONIVEL]: '#8a7a3a',
  [CertidaoStatus.NAO_CONSULTADA]: '#6b7280',
  [CertidaoStatus.CONSULTA_MANUAL]: '#6b7280',
  [CertidaoStatus.EXIGE_CERTIFICADO]: '#8a7a3a',
};

function escapeHtml(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatarCnpj(cnpj: string): string {
  return cnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatarData(iso: string | null): string {
  if (!iso) return '—';
  const partes = iso.slice(0, 10).split('-');
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatarDataHora(data: Date | null): string {
  if (!data) return '—';
  return new Date(data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

@Injectable()
export class RelatoriosService {
  constructor(
    @InjectRepository(Empresa) private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Socio) private readonly socioRepo: Repository<Socio>,
    @InjectRepository(Certidao) private readonly certidaoRepo: Repository<Certidao>,
  ) {}

  async gerarPreAnalisePdf(cnpjBruto: string): Promise<{ buffer: Buffer; nomeArquivo: string }> {
    const cnpj = sanitizeCnpj(cnpjBruto);
    const empresa = await this.empresaRepo.findOne({ where: { cnpj } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada. Consulte o CNPJ antes de gerar o relatório.');

    const [socios, certidoes] = await Promise.all([
      this.socioRepo.find({ where: { empresaId: empresa.id }, order: { nome: 'ASC' } }),
      this.certidaoRepo.find({ where: { empresaId: empresa.id }, order: { tipo: 'ASC' } }),
    ]);

    const html = this.montarHtml(empresa, socios, certidoes);

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      });
      return { buffer: pdf, nomeArquivo: `pre-analise-${cnpj}.pdf` };
    } finally {
      await browser.close();
    }
  }

  private montarHtml(empresa: Empresa, socios: Socio[], certidoes: Certidao[]): string {
    const endereco = [
      empresa.logradouro,
      empresa.numero,
      empresa.complemento,
    ].filter(Boolean).join(', ') || '—';
    const bairroCidade = [empresa.bairro, empresa.municipio && empresa.uf ? `${empresa.municipio}/${empresa.uf}` : empresa.municipio]
      .filter(Boolean).join(' — ') || '—';

    const linhasSocios = socios.length
      ? socios.map((s) => `
        <tr>
          <td>${escapeHtml(s.nome)}</td>
          <td>${escapeHtml(s.qualificacao) || '—'}</td>
          <td>${escapeHtml(s.faixaEtaria) || '—'}</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="vazio">Nenhum sócio cadastrado.</td></tr>';

    const linhasCertidoes = certidoes.length
      ? certidoes.map((c) => {
          const status = c.status as CertidaoStatus;
          const cor = STATUS_COR[status] ?? '#6b7280';
          const label = STATUS_LABEL[status] ?? c.status;
          return `
        <tr>
          <td>${escapeHtml(CERTIDAO_LABELS[c.tipo] ?? c.tipo)}</td>
          <td><span class="badge" style="background:${cor}22;color:${cor};border-color:${cor}55;">${escapeHtml(label)}</span></td>
          <td>${formatarData(c.validade)}</td>
          <td>${formatarData(c.dataConsulta ? c.dataConsulta.toISOString() : null)}</td>
        </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="vazio">Nenhuma certidão registrada ainda.</td></tr>';

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, 'Segoe UI', Arial, sans-serif;
    color: #1c2430;
    font-size: 12px;
  }
  .capa {
    background: linear-gradient(135deg, #0b1f3a 0%, #16345f 100%);
    color: #f4ead0;
    padding: 40px 48px 32px;
  }
  .marca { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: #d9a94a; font-weight: 700; margin-bottom: 18px; }
  .capa h1 { font-size: 24px; margin: 0 0 4px; }
  .capa .fantasia { color: #b9c4d6; font-size: 13px; margin-bottom: 14px; }
  .capa .linha-meta { display: flex; gap: 22px; flex-wrap: wrap; font-size: 12px; color: #d7deea; }
  .capa .linha-meta b { color: #fff; }
  .conteudo { padding: 28px 48px 40px; }
  h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: .06em;
    color: #16345f; border-bottom: 2px solid #d9a94a; padding-bottom: 6px; margin: 26px 0 12px;
  }
  h2:first-of-type { margin-top: 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .campo { padding: 4px 0; border-bottom: 1px solid #eee; }
  .campo .rotulo { color: #6b7280; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; }
  .campo .valor { font-size: 12.5px; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; padding: 6px 8px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
  .vazio { color: #9ca3af; font-style: italic; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; border: 1px solid; }
  .rodape { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="capa">
    <div class="marca">Relatório de Pré-Análise · Everest Contabilidade</div>
    <h1>${escapeHtml(empresa.razaoSocial)}</h1>
    <div class="fantasia">${escapeHtml(empresa.nomeFantasia) || 'Sem nome fantasia'}</div>
    <div class="linha-meta">
      <span>CNPJ: <b>${formatarCnpj(empresa.cnpj)}</b></span>
      <span>Situação: <b>${escapeHtml(empresa.situacaoCadastral)}</b></span>
      <span>Porte: <b>${escapeHtml(empresa.porte) || '—'}</b></span>
      <span>Gerado em: <b>${formatarDataHora(new Date())}</b></span>
    </div>
  </div>

  <div class="conteudo">
    <h2>Dados cadastrais</h2>
    <div class="grid-2">
      <div class="campo"><div class="rotulo">Natureza jurídica</div><div class="valor">${escapeHtml(empresa.naturezaJuridica) || '—'}</div></div>
      <div class="campo"><div class="rotulo">Início de atividade</div><div class="valor">${formatarData(empresa.dataInicioAtividade)}</div></div>
      <div class="campo"><div class="rotulo">CNAE principal</div><div class="valor">${escapeHtml(empresa.cnaePrincipalCodigo)} — ${escapeHtml(empresa.cnaePrincipalDescricao) || '—'}</div></div>
      <div class="campo"><div class="rotulo">Capital social</div><div class="valor">${empresa.capitalSocial != null ? `R$ ${Number(empresa.capitalSocial).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</div></div>
      <div class="campo"><div class="rotulo">Endereço</div><div class="valor">${escapeHtml(endereco)}</div></div>
      <div class="campo"><div class="rotulo">Bairro / Cidade</div><div class="valor">${escapeHtml(bairroCidade)}</div></div>
      <div class="campo"><div class="rotulo">Simples Nacional</div><div class="valor">${empresa.optanteSimples ? 'Optante' : 'Não optante'}</div></div>
      <div class="campo"><div class="rotulo">MEI</div><div class="valor">${empresa.optanteMei ? 'Optante' : 'Não optante'}</div></div>
    </div>

    <h2>Sócios</h2>
    <table>
      <thead><tr><th>Nome</th><th>Qualificação</th><th>Faixa etária</th></tr></thead>
      <tbody>${linhasSocios}</tbody>
    </table>

    <h2>Certidões</h2>
    <table>
      <thead><tr><th>Certidão</th><th>Status</th><th>Validade</th><th>Última consulta</th></tr></thead>
      <tbody>${linhasCertidoes}</tbody>
    </table>

    <div class="rodape">
      <span>Everest Contabilidade — Radar Empresarial</span>
      <span>CNPJ ${formatarCnpj(empresa.cnpj)}</span>
    </div>
  </div>
</body>
</html>`;
  }
}
