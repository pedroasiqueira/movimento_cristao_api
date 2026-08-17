import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'API da Arca da Sagrada Aliança – Movimento Cristão';
  }
}
