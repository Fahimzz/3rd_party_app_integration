import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JiraResolver } from './jira.resolver';
import { JiraService } from './jira.service';

@Module({
  imports: [AuthModule],
  providers: [JiraResolver, JiraService],
})
export class JiraModule {}
