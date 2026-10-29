import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, QueryFailedError, Repository } from 'typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { CertificadoDigital } from './entities/certificado-digital.entity';
import { Certidao } from '../database/entities/certidao.entity';
import { Anexo } from '../database/entities/anexo.entity';
import { CredenciaisCriptService } from '../credenciais/credenciais-cript.service';
import { GoogleDriveService, type PastaCandidata } from '../google-drive/google-drive.service';
import { extrairIdPasta } from '../google-drive/extrair-id-pasta.util';
import type {
  CriarEmpresaDto,
  AtualizarEmpresaDto,
  UploadCertificadoDto,
  CertificadoPublico,
} from './empresas.dto';

@Injectable()
export class EmpresasService {
  constructor(
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(CertificadoDigital)
    private readonly certificadoRepo: Repository<CertificadoDigital>,
    @InjectRepository(Certidao)
    private readonly certidaoRepo: Repository<Certidao>,
    @InjectRepository(Anexo)
    private readonly anexoRepo: Repository<Anexo>,
    private readonly cript: CredenciaisCriptService,
    private readonly googleDrive: GoogleDriveService,
  ) {}

  // Sugestões de pasta no Drive pra esse cliente, por nome parecido, dentro
  // da pasta raiz configurada — o usuário confirma qual é a certa (ver
  // confirmarPastaDrive); nunca associa sozinho.
  async buscarCandidatosPastaDrive(id: string): Promise<PastaCandidata[]> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    return this.googleDrive.buscarCandidatos(empresa.razaoSocial);
  }

  // Depois que o usuário confirma qual pasta (de buscarCandidatosPastaDrive)
  // é a do cliente, acha/cria a subpasta de relatório dentro dela e salva
  // como destino final.
  async confirmarPastaDrive(id: string, pastaClienteId: string): Promise<{ pastaDriveId: string; nome: string }> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    const { id: pastaRelatorioId, nome } = await this.googleDrive.resolverPastaRelatorio(pastaClienteId);
    await this.empresaRepo.update(id, { pastaDriveId: pastaRelatorioId });
    return { pastaDriveId: pastaRelatorioId, nome };
  }

  // Liberdade de colar o link direto, sem passar pela busca automática —
  // útil quando o nome do cliente não bate com nada na pasta raiz.
  async definirPastaDriveManual(id: string, pastaDriveId: string | null): Promise<void> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException('Empresa não encontrada.');
    await this.empresaRepo.update(id, { pastaDriveId: pastaDriveId ? extrairIdPasta(pastaDriveId) : null });
  }

  async listar(busca?: string): Promise<Empresa[]> {
    if (!busca) {
      return this.empresaRepo.find({ order: { razaoSocial: 'ASC' }, take: 200 });
    }
    // Match parcial no CNPJ (ex: digitar só os 6 primeiros dígitos já filtra) —
    // antes só casava CNPJ completo exato, então buscar por prefixo não
    // retornava nada mesmo com o placeholder do campo prometendo isso.
    const buscaLimpa = busca.replace(/\D/g, '');
    const where = buscaLimpa
      ? [{ cnpj: ILike(`%${buscaLimpa}%`) }, { razaoSocial: ILike(`%${busca}%`) }]
      : [{ razaoSocial: ILike(`%${busca}%`) }];
    return this.empresaRepo.find({ where, order: { razaoSocial: 'ASC' }, take: 200 });
  }

  async buscarPorId(id: string): Promise<{ empresa: Empresa; certificado: CertificadoPublico | null }> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada.`);

    const certificado = await this.certificadoRepo.findOne({
      where: { empresaId: id, ativo: true },
      order: { criadoEm: 'DESC' },
    });

    return { empresa, certificado: certificado ? this.certificadoToPublic(certificado) : null };
  }

  async criar(dto: CriarEmpresaDto): Promise<Empresa> {
    const cnpjLimpo = dto.cnpj.replace(/\D/g, '');
    if (!cnpjLimpo || !dto.razaoSocial?.trim()) {
      throw new BadRequestException('CNPJ e razão social são obrigatórios.');
    }

    const existente = await this.empresaRepo.findOne({ where: { cnpj: cnpjLimpo } });
    if (existente) {
      throw new ConflictException(`Já existe uma empresa cadastrada com o CNPJ ${cnpjLimpo}.`);
    }

    const empresa = this.empresaRepo.create({
      cnpj: cnpjLimpo,
      razaoSocial: dto.razaoSocial.trim(),
      situacaoCadastral: 'NÃO INFORMADA', // sem consulta à Receita — cadastro manual
      inscricaoMobiliaria: dto.inscricaoMobiliaria ?? null,
      cga: dto.cga ?? null,
      inscricaoEstadual: dto.inscricaoEstadual ?? null,
    });
    return this.empresaRepo.save(empresa);
  }

  async atualizar(id: string, dto: AtualizarEmpresaDto): Promise<Empresa> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada.`);

    if (dto.razaoSocial !== undefined) empresa.razaoSocial = dto.razaoSocial.trim();
    if (dto.inscricaoMobiliaria !== undefined) empresa.inscricaoMobiliaria = dto.inscricaoMobiliaria || null;
    if (dto.cga !== undefined) empresa.cga = dto.cga || null;
    if (dto.inscricaoEstadual !== undefined) empresa.inscricaoEstadual = dto.inscricaoEstadual || null;

    return this.empresaRepo.save(empresa);
  }

  async uploadCertificado(
    empresaId: string,
    arquivo: Express.Multer.File,
    dto: UploadCertificadoDto,
  ): Promise<CertificadoPublico> {
    const empresa = await this.empresaRepo.findOne({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException(`Empresa ${empresaId} não encontrada.`);
    if (!dto.senha) throw new BadRequestException('Senha do certificado é obrigatória.');
    if (dto.tipo !== 'A1' && dto.tipo !== 'A3') throw new BadRequestException('Tipo deve ser A1 ou A3.');

    // Desativa certificado anterior (histórico, não apaga) antes de criar o novo.
    await this.certificadoRepo.update({ empresaId, ativo: true }, { ativo: false });

    const payload = JSON.stringify({
      arquivoBase64: arquivo.buffer.toString('base64'),
      senha: dto.senha,
    });
    const { valor, iv, tag } = this.cript.encrypt(payload);

    const certificado = this.certificadoRepo.create({
      empresaId,
      tipo: dto.tipo,
      titular: dto.titular ?? null,
      validade: dto.validade ?? null,
      nomeArquivo: arquivo.originalname,
      conteudoCriptografado: valor,
      iv,
      tag,
    });

    return this.certificadoToPublic(await this.certificadoRepo.save(certificado));
  }

  async remover(id: string): Promise<{ ok: boolean }> {
    const empresa = await this.empresaRepo.findOne({ where: { id } });
    if (!empresa) throw new NotFoundException(`Empresa ${id} não encontrada.`);

    // Certidao e Anexo não têm relação/FK com Empresa no banco (só a coluna
    // empresa_id) — sem apagar aqui, ficariam órfãs após o DELETE abaixo.
    // Os demais relacionados (sócios, CNAEs, consultas, certificados, leads)
    // já têm ON DELETE CASCADE/SET NULL nativo e são resolvidos pelo banco.
    await this.certidaoRepo.delete({ empresaId: id });
    await this.anexoRepo.delete({ empresaId: id });

    try {
      await this.empresaRepo.delete({ id });
    } catch (err) {
      if (err instanceof QueryFailedError) {
        throw new BadRequestException(
          'Não foi possível remover: existem outros registros vinculados a esta empresa.',
        );
      }
      throw err;
    }

    return { ok: true };
  }

  async removerCertificado(empresaId: string): Promise<{ ok: boolean }> {
    await this.certificadoRepo.update({ empresaId, ativo: true }, { ativo: false });
    return { ok: true };
  }

  // Uso interno pelos futuros scrapers de e-CAC — nunca exposto via HTTP.
  async obterCertificadoDecodificado(
    empresaId: string,
  ): Promise<{ arquivoBuffer: Buffer; senha: string; tipo: CertificadoPublico['tipo'] } | null> {
    const certificado = await this.certificadoRepo.findOne({
      where: { empresaId, ativo: true },
      order: { criadoEm: 'DESC' },
    });
    if (!certificado) return null;

    const payload = JSON.parse(
      this.cript.decrypt(certificado.conteudoCriptografado, certificado.iv, certificado.tag),
    ) as { arquivoBase64: string; senha: string };

    return {
      arquivoBuffer: Buffer.from(payload.arquivoBase64, 'base64'),
      senha: payload.senha,
      tipo: certificado.tipo,
    };
  }

  private certificadoToPublic(c: CertificadoDigital): CertificadoPublico {
    return {
      id: c.id,
      tipo: c.tipo,
      titular: c.titular,
      validade: c.validade,
      nomeArquivo: c.nomeArquivo,
      criadoEm: c.criadoEm,
    };
  }
}
