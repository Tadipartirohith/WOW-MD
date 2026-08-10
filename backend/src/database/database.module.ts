import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        type: 'postgres',
        host: cfg.database.host,
        port: cfg.database.port,
        username: cfg.database.username,
        password: cfg.database.password,
        database: cfg.database.name,
        ssl: cfg.database.ssl ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: cfg.database.synchronize, // always false, migrations own the schema
        logging: cfg.database.logging,
        extra: { max: cfg.database.poolSize },
      }),
    }),
  ],
})
export class DatabaseModule {}
