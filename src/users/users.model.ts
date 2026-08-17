import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Role } from '../auth/roles.enum';

/*
 * Usuários são apenas operadores (Publicador/Construtor) — o site público
 * não tem cadastro nem coleta de dados (PRD §8, LGPD). Nascem pelo seed;
 * não há rota pública de criação.
 */
@Schema({ timestamps: true, collection: 'usuarios' })
export class Usuario {
  @Prop({ required: true, trim: true })
  nome: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop({ type: String, enum: Role, default: Role.ADMIN })
  role: Role;

  createdAt?: Date;
  updatedAt?: Date;
}

export type UsuarioDocument = Usuario & Document;
export const UsuarioSchema = SchemaFactory.createForClass(Usuario);
