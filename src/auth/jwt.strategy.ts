import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

type JwtPayload = { sub: string; email: string; role: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Rebusca o usuário a cada request (padrão do dacapo): o token de alguém
  // removido deixa de valer na hora, não só quando expira.
  async validate(payload: JwtPayload) {
    const usuario = await this.usersService.findById(payload.sub);
    if (!usuario) {
      throw new UnauthorizedException('Usuário não encontrado ou removido.');
    }
    return {
      userId: String(usuario._id),
      email: usuario.email,
      role: usuario.role,
    };
  }
}
