import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GithubResolver } from './github.resolver';
import { GithubService } from './github.service';

@Module({
  imports: [AuthModule],
  providers: [GithubResolver, GithubService],
})
export class GithubModule {}

