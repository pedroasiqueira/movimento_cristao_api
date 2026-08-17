import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const usuario = await this.usersService.findByEmail(loginDto.email);
    const senhaConfere =
      usuario && (await bcrypt.compare(loginDto.password, usuario.password));
    if (!senhaConfere) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const payload = {
      sub: String(usuario._id),
      email: usuario.email,
      role: usuario.role,
    };
    return { access_token: this.jwtService.sign(payload) };
  }

  async me(userId: string) {
    const usuario = await this.usersService.findById(userId);
    if (!usuario) {
      throw new UnauthorizedException('Usuário não encontrado ou removido.');
    }
    // Sanitização manual, como no dacapo: nunca devolver password.
    return {
      userId,
      nome: usuario.nome,
      email: usuario.email,
      role: usuario.role,
    };
  }
}
