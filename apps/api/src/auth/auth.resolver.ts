import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { CurrentUserDto } from './dto/current-user.dto';
import { LoginInput } from './dto/login.input';
import { SignupInput } from './dto/signup.input';
import { AuthUserEntity } from './entities/auth-user.entity';
import { GqlAuthGuard } from './gql-auth.guard';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  @Mutation(() => AuthResponseDto)
  signup(@Args('input') input: SignupInput) {
    return this.authService.signup(input);
  }

  @Mutation(() => AuthResponseDto)
  login(@Args('input') input: LoginInput) {
    return this.authService.login(input);
  }

  @Query(() => CurrentUserDto)
  @UseGuards(GqlAuthGuard)
  me(@CurrentUser() user: AuthUserEntity) {
    return this.authService.me(user.id);
  }
}
