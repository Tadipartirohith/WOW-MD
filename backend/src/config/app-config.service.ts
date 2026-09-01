import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Cfg = ReturnType<typeof import('./configuration').default>;

/**
 * Typed accessor over the validated configuration. Inject THIS everywhere
 * instead of reading process.env or ConfigService with string keys.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  private section<K extends keyof Cfg>(key: K): Cfg[K] {
    return this.config.get(key as string) as Cfg[K];
  }

  get runtime() {
    return this.section('runtime');
  }
  get database() {
    return this.section('database');
  }
  get redis() {
    return this.section('redis');
  }
  get auth() {
    return this.section('auth');
  }
  get features() {
    return this.section('features');
  }
  get security() {
    return this.section('security');
  }
  get pagination() {
    return this.section('pagination');
  }
  get stewardship() {
    return this.section('stewardship');
  }
  get mail() {
    return this.section('mail');
  }
  get webrtc() {
    return this.section('webrtc');
  }
  get sms() {
    return this.section('sms');
  }
  get support() {
    return this.section('support');
  }
  get push() {
    return this.section('push');
  }
  get whatsapp() {
    return this.section('whatsapp');
  }
  get matchmaking() {
    return this.section('matchmaking');
  }
  get media() {
    return this.section('media');
  }
  get payments() {
    return this.section('payments');
  }
  get identity() {
    return this.section('identity');
  }
  get verification() {
    return this.section('verification');
  }
  get moderation() {
    return this.section('moderation');
  }
  get ai() {
    return this.section('ai');
  }
  get neo4j() {
    return this.section('neo4j');
  }
  get kafka() {
    return this.section('kafka');
  }

  get isProduction() {
    return this.runtime.env === 'production';
  }
}
