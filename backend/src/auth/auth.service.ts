import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Usuario, PerfilUsuario } from '../database/entities/usuario.entity';

export interface LoginDto {
  email: string;
  senha: string;
}

export interface CriarUsuarioDto {
  nome: string;
  email: string;
  senha: string;
  perfil?: PerfilUsuario;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usuarioRepo.findOne({ where: { email: dto.email.toLowerCase(), ativo: true } });
    if (!user) throw new UnauthorizedException('E-mail ou senha incorretos.');

    const ok = await bcrypt.compare(dto.senha, user.senhaHash);
    if (!ok) throw new UnauthorizedException('E-mail ou senha incorretos.');

    const token = this.jwtService.sign({ sub: user.id, email: user.email, perfil: user.perfil });
    return {
      access_token: token,
      usuario: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil },
    };
  }

  async criarUsuario(dto: CriarUsuarioDto): Promise<Omit<Usuario, 'senhaHash'>> {
    const existe = await this.usuarioRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existe) throw new ConflictException('E-mail já cadastrado.');

    const senhaHash = await bcrypt.hash(dto.senha, 12);
    const novo = this.usuarioRepo.create({
      nome: dto.nome,
      email: dto.email.toLowerCase(),
      senhaHash,
      perfil: dto.perfil ?? 'consultor',
    });
    const salvo = await this.usuarioRepo.save(novo);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { senhaHash: _, ...sem } = salvo;
    return sem as Omit<Usuario, 'senhaHash'>;
  }

  async listarUsuarios(): Promise<Omit<Usuario, 'senhaHash'>[]> {
    const lista = await this.usuarioRepo.find({ order: { nome: 'ASC' } });
    return lista.map(({ senhaHash: _, ...u }) => u as Omit<Usuario, 'senhaHash'>);
  }

  async alterarSenha(id: string, novaSenha: string): Promise<void> {
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    await this.usuarioRepo.update(id, { senhaHash });
  }

  async desativarUsuario(id: string): Promise<void> {
    await this.usuarioRepo.update(id, { ativo: false });
  }
}
