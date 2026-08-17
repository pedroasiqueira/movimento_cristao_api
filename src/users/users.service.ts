import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { Role } from '../auth/roles.enum';
import { Usuario, UsuarioDocument } from './users.model';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(Usuario.name)
    private readonly usuarioModel: Model<UsuarioDocument>,
  ) {}

  findByEmail(email: string) {
    return this.usuarioModel.findOne({ email: email.toLowerCase() }).exec();
  }

  findById(id: string) {
    return this.usuarioModel.findById(id).exec();
  }

  async criar(
    nome: string,
    email: string,
    senha: string,
    role: Role = Role.ADMIN,
  ) {
    const existente = await this.findByEmail(email);
    if (existente) {
      throw new ConflictException('Já existe um usuário com esse e-mail.');
    }
    const salt = await bcrypt.genSalt();
    const password = await bcrypt.hash(senha, salt);
    return this.usuarioModel.create({
      nome,
      email: email.toLowerCase(),
      password,
      role,
    });
  }
}
