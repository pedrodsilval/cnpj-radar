import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Credencial, CredencialTipo } from './credencial.entity';
import { CriarCredencialDto, AtualizarCredencialDto, CredencialPublica } from './credenciais.dto';
import { CredenciaisCriptService } from './credenciais-cript.service';

@Injectable()
export class CredenciaisService {
  constructor(
    @InjectRepository(Credencial)
    private readonly repo: Repository<Credencial>,
    private readonly cript: CredenciaisCriptService,
  ) {}

  async criar(dto: CriarCredencialDto): Promise<CredencialPublica> {
    const { valor, iv, tag } = this.cript.encrypt(dto.valor);
    const credencial = this.repo.create({
      tipo: dto.tipo as CredencialTipo,
      descricao: dto.descricao,
      valorCriptografado: valor,
      iv,
      tag,
    });
    return this.toPublic(await this.repo.save(credencial));
  }

  async listar(): Promise<CredencialPublica[]> {
    const todos = await this.repo.find({ order: { criadoEm: 'DESC' } });
    return todos.map((c) => this.toPublic(c));
  }

  async atualizar(id: string, dto: AtualizarCredencialDto): Promise<CredencialPublica> {
    const credencial = await this.repo.findOne({ where: { id } });
    if (!credencial) throw new NotFoundException(`Credencial ${id} não encontrada.`);

    if (dto.descricao !== undefined) credencial.descricao = dto.descricao;
    if (dto.ativo !== undefined) credencial.ativo = dto.ativo;
    if (dto.valor) {
      const { valor, iv, tag } = this.cript.encrypt(dto.valor);
      credencial.valorCriptografado = valor;
      credencial.iv = iv;
      credencial.tag = tag;
    }

    return this.toPublic(await this.repo.save(credencial));
  }

  async remover(id: string): Promise<{ ok: boolean }> {
    const credencial = await this.repo.findOne({ where: { id } });
    if (!credencial) throw new NotFoundException(`Credencial ${id} não encontrada.`);
    await this.repo.remove(credencial);
    return { ok: true };
  }

  // Uso interno pelos scrapers — nunca exposto via HTTP
  async obterValor(tipo: CredencialTipo): Promise<string | null> {
    const credencial = await this.repo.findOne({
      where: { tipo, ativo: true },
      order: { criadoEm: 'DESC' },
    });
    if (!credencial) return null;
    return this.cript.decrypt(credencial.valorCriptografado, credencial.iv, credencial.tag);
  }

  private toPublic(c: Credencial): CredencialPublica {
    return {
      id: c.id,
      tipo: c.tipo,
      descricao: c.descricao,
      valorMascarado: '••••••••',
      ativo: c.ativo,
      ultimaVerificacao: c.ultimaVerificacao,
      criadoEm: c.criadoEm,
      atualizadoEm: c.atualizadoEm,
    };
  }
}
