import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tarefa, PrioridadeTarefa, StatusTarefa } from './entities/tarefa.entity';

export interface CriarTarefaDto {
  titulo: string;
  descricao?: string;
  prioridade?: PrioridadeTarefa;
  responsavelId?: string;
  responsavelNome?: string;
  cnpjVinculado?: string;
  leadId?: string;
  certidaoId?: string;
  dataLimite?: string;
}

export interface AtualizarTarefaDto {
  titulo?: string;
  descricao?: string;
  status?: StatusTarefa;
  prioridade?: PrioridadeTarefa;
  responsavelId?: string;
  responsavelNome?: string;
  dataLimite?: string;
}

@Injectable()
export class TarefasService {
  constructor(
    @InjectRepository(Tarefa)
    private readonly repo: Repository<Tarefa>,
  ) {}

  async listar(status?: StatusTarefa, responsavelId?: string): Promise<Tarefa[]> {
    const qb = this.repo.createQueryBuilder('t').orderBy('t.data_limite', 'ASC', 'NULLS LAST').addOrderBy('t.prioridade', 'DESC').addOrderBy('t.criado_em', 'DESC');
    if (status)        qb.andWhere('t.status = :status', { status });
    if (responsavelId) qb.andWhere('t.responsavel_id = :responsavelId', { responsavelId });
    return qb.getMany();
  }

  async criar(dto: CriarTarefaDto): Promise<Tarefa> {
    const t = this.repo.create({
      titulo:          dto.titulo,
      descricao:       dto.descricao       ?? null,
      prioridade:      dto.prioridade      ?? 'media',
      responsavelId:   dto.responsavelId   ?? null,
      responsavelNome: dto.responsavelNome ?? null,
      cnpjVinculado:   dto.cnpjVinculado   ?? null,
      leadId:          dto.leadId          ?? null,
      certidaoId:      dto.certidaoId      ?? null,
      dataLimite:      dto.dataLimite      ?? null,
      status:          'pendente',
    });
    return this.repo.save(t);
  }

  async atualizar(id: string, dto: AtualizarTarefaDto): Promise<Tarefa> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Tarefa não encontrada.');

    if (dto.status === 'concluida' && t.status !== 'concluida') {
      t.concluidaEm = new Date();
    } else if (dto.status && dto.status !== 'concluida') {
      t.concluidaEm = null;
    }

    Object.assign(t, dto);
    return this.repo.save(t);
  }

  async remover(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  async contarPendentes(): Promise<number> {
    return this.repo.count({ where: [{ status: 'pendente' }, { status: 'em_andamento' }] });
  }
}
