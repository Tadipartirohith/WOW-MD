import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';
import configuration from '../config/configuration';

loadEnv();

const cfg = configuration();

/**
 * Standalone TypeORM DataSource used by the TypeORM CLI for migrations.
 * The app itself configures TypeORM via TypeOrmModule (see database.module.ts),
 * but both read the SAME settings from `configuration.ts`.
 */
export default new DataSource({
  type: 'postgres',
  host: cfg.database.host,
  port: cfg.database.port,
  username: cfg.database.username,
  password: cfg.database.password,
  database: cfg.database.name,
  ssl: cfg.database.ssl ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: cfg.database.logging,
});
