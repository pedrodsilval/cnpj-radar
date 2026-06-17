import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PerfilUsuario = 'administrador' | 'comercial' | 'financeiro' | 'consultor' | 'leitura';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  nome: string;

  @Column({ unique: true, type: 'varchar' })
  email: string;

  @Column({ name: 'senha_hash', type: 'varchar' })
  senhaHash: string;

  @Column({ type: 'varchar', length: 30, default: 'consultor' })
  perfil: PerfilUsuario;

  @Column({ type: 'boolean', default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
