import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../database/entities/usuario.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  perfil: string;
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'cnpj-radar-secret-change-in-prod',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usuarioRepo.findOne({ where: { id: payload.sub, ativo: true } });
    if (!user) throw new UnauthorizedException('Usuário inativo ou não encontrado.');
    if (user.tokenVersion !== (payload.tv ?? 0)) {
      throw new UnauthorizedException('Sessão encerrada. Faça login novamente.');
    }
    return { id: user.id, email: user.email, perfil: user.perfil, nome: user.nome };
  }
}
