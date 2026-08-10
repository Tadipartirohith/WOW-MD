import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import neo4j, { Driver } from 'neo4j-driver';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Optional Neo4j integration for graph-based matchmaking. When NEO4J_ENABLED is
 * false (the default) every method is a safe no-op and `ready` stays false, so
 * the matchmaking service falls back to Postgres scoring. When enabled, user
 * nodes and interest edges are mirrored here and suggestions can use graph
 * traversal (mutual and second-degree connections).
 */
@Injectable()
export class Neo4jService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);
  private driver: Driver | null = null;
  private _ready = false;

  constructor(private readonly cfg: AppConfigService) {}

  get ready(): boolean {
    return this._ready;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.neo4j.enabled) {
      this.logger.log('Neo4j disabled; matchmaking will use Postgres scoring.');
      return;
    }
    try {
      this.driver = neo4j.driver(
        this.cfg.neo4j.uri,
        neo4j.auth.basic(this.cfg.neo4j.username, this.cfg.neo4j.password),
      );
      await this.driver.verifyConnectivity();
      this._ready = true;
      this.logger.log('Neo4j connected; graph matchmaking active.');
    } catch (err) {
      this._ready = false;
      this.logger.warn(
        `Neo4j unreachable, falling back to Postgres: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  async upsertUser(userId: string, gender: string | null): Promise<void> {
    if (!this._ready || !this.driver) return;
    const session = this.driver.session();
    try {
      await session.run('MERGE (u:User {id:$userId}) SET u.gender=$gender', { userId, gender });
    } finally {
      await session.close();
    }
  }

  /** status is INTERESTED or ACCEPTED. */
  async recordInterest(fromUserId: string, toUserId: string, status: string): Promise<void> {
    if (!this._ready || !this.driver) return;
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (a:User {id:$fromUserId})
         MERGE (b:User {id:$toUserId})
         MERGE (a)-[r:INTEREST]->(b) SET r.status=$status`,
        { fromUserId, toUserId, status },
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Ordered candidate user ids for a user, preferring people that this user's
   * accepted matches are also interested in (second-degree), excluding anyone
   * already interacted with.
   */
  async suggestions(userId: string, limit: number): Promise<string[]> {
    if (!this._ready || !this.driver) return [];
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (me:User {id:$userId})-[:INTEREST {status:'ACCEPTED'}]-(friend)-[:INTEREST]->(cand:User)
         WHERE cand.id <> $userId
           AND NOT (me)-[:INTEREST]-(cand)
         RETURN cand.id AS id, count(*) AS score
         ORDER BY score DESC LIMIT toInteger($limit)`,
        { userId, limit },
      );
      return res.records.map((r) => r.get('id') as string);
    } finally {
      await session.close();
    }
  }
}
