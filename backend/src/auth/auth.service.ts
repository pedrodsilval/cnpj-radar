import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    const email = dto.email.toLowerCase();
    const user = await this.usuarioRepo.findOne({ where: { email, ativo: true } });

    if (!user) {
      this.logger.warn(`[AUTH] Login falhou (e-mail não encontrado): ${email} IP:${ip ?? 'desconhecido'}`);
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    const ok = await bcrypt.compare(dto.senha, user.senhaHash);
    if (!ok) {
      this.logger.warn(`[AUTH] Login falhou (senha incorreta): ${email} IP:${ip ?? 'desconhecido'}`);
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    this.logger.log(`[AUTH] Login bem-sucedido: ${email} (ID:${user.id}) IP:${ip ?? 'desconhecido'}`);
    const token = this.jwtService.sign({ sub: user.id, email: user.email, perfil: user.perfil, tv: user.tokenVersion });
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
    const user = await this.usuarioRepo.findOneOrFail({ where: { id } });
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    await this.usuarioRepo.update(id, { senhaHash, tokenVersion: user.tokenVersion + 1 });
    this.logger.log(`[AUTH] Senha alterada: ID:${id} — tokens anteriores invalidados`);
  }

  async desativarUsuario(id: string): Promise<void> {
    await this.usuarioRepo.update(id, { ativo: false });
  }
}
