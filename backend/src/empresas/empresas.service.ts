import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { CertificadoDigital } from './entities/certificado-digital.entity';
import { CredenciaisCriptService } from '../credenciais/credenciais-cript.service';
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
    private readonly cript: CredenciaisCriptService,
  ) {}

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
