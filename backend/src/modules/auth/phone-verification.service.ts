import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { randomInt } from 'crypto';
import { PhoneCodePurpose, PhoneVerification } from './entities/phone-verification.entity';
import { User } from './entities/user.entity';
import { SmsService } from '../../platform/sms/sms.service';
import { AppConfigService } from '../../config/app-config.service';
import { hashToken } from '../../common/util/tokens';

/** Three guesses is what makes six digits defensible. */
const MAX_ATTEMPTS = 3;

/**
 * Confirming that a mobile number is real and belongs to the account holder.
 *
 * This matters more here than email verification does. The number is what an
 * agent takes at intake, what duplicate detection keys on, and what a family
 * actually answers — and until now it was collected, validated against a format
 * and then trusted without ever being tested.
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    @InjectRepository(PhoneVerification)
    private readonly codes: Repository<PhoneVerification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sms: SmsService,
    private readonly cfg: AppConfigService,
  ) {}

  /**
   * Issues a code to the number on the account.
   *
   * Any outstanding code is consumed first, so the most recent message is
   * always the one that works — somebody who taps "resend" twice and then reads
   * the first message would otherwise be told their correct code is wrong.
   */
  async request(userId: string): Promise<{ sent: boolean; expiresAt: Date; devCode?: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');
    if (!user.phone) {
      throw new BadRequestException('Add a mobile number to your profile first');
    }
    if (user.phoneVerifiedAt) {
      throw new BadRequestException('That number is already verified');
    }

    return this.issue(user.id, user.phone, PhoneCodePurpose.VERIFY);
  }

  /**
   * A sign-in code for a number that is already on an account (EZ1-I258).
   *
   * Separate from `request` above, and not merely because the account is
   * already known: that one refuses a number that has been verified, which is
   * precisely the state a sign-in code is wanted in.
   */
  async requestLogin(
    userId: string,
    phone: string,
  ): Promise<{ sent: boolean; expiresAt: Date; devCode?: string }> {
    return this.issue(userId, phone, PhoneCodePurpose.LOGIN);
  }

  /**
   * Mints, stores and sends a code.
   *
   * Any outstanding code for the same purpose is consumed first, so the most
   * recent message is always the one that works — somebody who taps "resend"
   * twice and then reads the first message would otherwise be told their
   * correct code is wrong. Codes for the *other* purpose are left alone: a
   * sign-in attempt has no business cancelling a verification in flight.
   */
  private async issue(
    userId: string,
    phone: string,
    purpose: PhoneCodePurpose,
  ): Promise<{ sent: boolean; expiresAt: Date; devCode?: string }> {
    await this.codes.update(
      { userId, purpose, consumedAt: IsNull() },
      { consumedAt: new Date() },
    );

    // randomInt is the CSPRNG. Math.random() would be predictable enough to
    // guess, and this is the whole of the proof.
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + this.cfg.sms.verificationTtlMinutes * 60_000);

    await this.codes.save(
      this.codes.create({
        userId,
        phone,
        purpose,
        codeHash: hashToken(code),
        expiresAt,
      }),
    );

    const sent = await this.sms.sendPhoneVerification({ to: phone, code });

    // In `log` mode nothing is actually delivered, so the code would be
    // unreachable. Hand it back only in that mode — it is the whole credential.
    const dev = this.cfg.sms.provider === 'log' ? { devCode: code } : {};
    return { sent, expiresAt, ...dev };
  }

  /**
   * Checks a code and marks the number verified.
   *
   * A wrong guess is counted before anything else, so a script cannot burn
   * through the space by retrying — and the count is on the row rather than in
   * memory, so it survives a restart and applies across replicas.
   */
  async confirm(userId: string, code: string): Promise<{ verified: true }> {
    const outstanding = await this.check(userId, code, PhoneCodePurpose.VERIFY);

    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found');

    // The number the code was sent to, not whatever is on the account now —
    // changing the number mid-flow must not verify the new one.
    user.phone = outstanding.phone;
    user.phoneVerifiedAt = new Date();
    await this.users.save(user);

    return { verified: true };
  }

  /**
   * Checks a sign-in code and spends it (EZ1-I258).
   *
   * The same three defences as the verification path — expiry, three guesses,
   * one use — because they are what make six digits a credential at all.
   * Returns nothing: whether the person may sign in is not this service's
   * decision, and the caller holds the account.
   */
  async confirmLogin(userId: string, code: string): Promise<void> {
    await this.check(userId, code, PhoneCodePurpose.LOGIN);
  }

  /**
   * The outstanding code for a purpose, checked and spent.
   *
   * A wrong guess is counted before anything else, so a script cannot burn
   * through the space by retrying — and the count is on the row rather than in
   * memory, so it survives a restart and applies across replicas.
   */
  private async check(
    userId: string,
    code: string,
    purpose: PhoneCodePurpose,
  ): Promise<PhoneVerification> {
    const outstanding = await this.codes.findOne({
      where: { userId, purpose, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!outstanding) {
      throw new BadRequestException('Ask for a code first');
    }
    if (outstanding.expiresAt.getTime() <= Date.now()) {
      outstanding.consumedAt = new Date();
      await this.codes.save(outstanding);
      throw new BadRequestException('That code has expired. Ask for a new one.');
    }
    if (outstanding.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many wrong codes. Ask for a new one.');
    }

    if (outstanding.codeHash !== hashToken(code)) {
      outstanding.attempts += 1;
      await this.codes.save(outstanding);
      throw new BadRequestException('That code is not right');
    }

    outstanding.consumedAt = new Date();
    return this.codes.save(outstanding);
  }

  /** Called by the scheduled cleanup; expired codes have no reason to persist. */
  async pruneExpired(): Promise<number> {
    const result = await this.codes.delete({ expiresAt: LessThan(new Date()) });
    return result.affected ?? 0;
  }
}
