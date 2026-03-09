import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthUserEntity } from './entities/auth-user.entity';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUserEntity | undefined => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext<{ req?: { user?: AuthUserEntity } }>().req?.user;
  },
);
