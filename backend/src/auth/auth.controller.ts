import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { CriarUsuarioDto, LoginDto } from './auth.service';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  me(@Request() req: { user: { id: string; nome: string; email: string; perfil: string } }) {
    return req.user;
  }

  @Roles('administrador')
  @Post('usuarios')
  criarUsuario(@Body() dto: CriarUsuarioDto) {
    return this.authService.criarUsuario(dto);
  }

  @Roles('administrador')
  @Get('usuarios')
  listarUsuarios() {
    return this.authService.listarUsuarios();
  }

  // Qualquer usuário pode alterar a própria senha; admin pode alterar qualquer uma
  @Patch('usuarios/:id/senha')
  alterarSenha(
    @Param('id') id: string,
    @Body('senha') senha: string,
    @Request() req: { user: { id: string; perfil: string } },
  ) {
    if (req.user.perfil !== 'administrador' && req.user.id !== id) {
      throw new ForbiddenException('Você só pode alterar sua própria senha.');
    }
    return this.authService.alterarSenha(id, senha);
  }

  @Roles('administrador')
  @Delete('usuarios/:id')
  desativarUsuario(@Param('id') id: string) {
    return this.authService.desativarUsuario(id);
  }
}
