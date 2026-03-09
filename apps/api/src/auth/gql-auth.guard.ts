import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { JwtService } from '@nestjs/jwt';
import { AuthUserEntity } from './entities/auth-user.entity';

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const request = ctx.getContext<{ req?: { headers?: Record<string, string | undefined>; user?: AuthUserEntity } }>().req;
    const authHeader = request?.headers?.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7);

    try {
      const payload = this.jwtService.verify<AuthUserEntity>(token);
      if (request) {
        request.user = payload;
      }
      return true;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
