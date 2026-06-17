import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { CriarUsuarioDto, LoginDto } from './auth.service';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('administrador')
  @Post('usuarios')
  criarUsuario(@Body() dto: CriarUsuarioDto) {
    return this.authService.criarUsuario(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('administrador')
  @Get('usuarios')
  listarUsuarios() {
    return this.authService.listarUsuarios();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('administrador')
  @Patch('usuarios/:id/senha')
  alterarSenha(@Param('id') id: string, @Body('senha') senha: string) {
    return this.authService.alterarSenha(id, senha);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('administrador')
  @Delete('usuarios/:id')
  desativarUsuario(@Param('id') id: string) {
    return this.authService.desativarUsuario(id);
  }
}
