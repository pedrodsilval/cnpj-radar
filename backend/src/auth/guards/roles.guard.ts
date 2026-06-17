import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { PerfilUsuario } from '../../database/entities/usuario.entity';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PerfilUsuario[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user: { perfil: PerfilUsuario } }>();
    if (!user) throw new ForbiddenException('Acesso negado.');

    // administrador always passes
    if (user.perfil === 'administrador') return true;

    if (!required.includes(user.perfil)) {
      throw new ForbiddenException(`Perfil '${user.perfil}' não tem permissão para esta ação.`);
    }
    return true;
  }
}
