import { Module } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { CredenciaisModule } from '../credenciais/credenciais.module';

@Module({
  imports: [CredenciaisModule],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
