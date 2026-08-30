import { Inject, Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { VendorsService } from '../vendors/vendors.service';
import { VendorCategory } from '../../common/enums';
import { AI_PROVIDER, AiProvider } from './ai.provider';

/**
 * WOW Genie, orchestrates existing platform data into recommendations and
 * assistant responses. Match/vendor recos reuse the real engines; budget
 * insights are rule-based; free-form Q&A goes through the pluggable AiProvider.
 */
// One table, shared with the Genie, so the panel and the answer beside it
// cannot disagree about where the money goes.
import { BUDGET_ALLOCATION } from './genie-knowledge';

@Injectable()
export class AiService {
  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly vendors: VendorsService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /**
   * The recommended matches panel.
   *
   * Floored at fifty percent deliberately: a recommendation is a claim that
   * this is worth the family's attention, and a list padded out with
   * twelve-percent matches to reach five rows teaches people to ignore it.
   * Fewer rows is the correct answer when there are fewer good matches.
   */
  /**
   * The shortlist, for whoever is being browsed as.
   *
   * `profileId` used to be dropped on the floor here, so an agent looking at a
   * client's Matches page got the *agency account's* recommendations in the
   * right-hand column — profiles of every gender, unrelated to the client
   * whose name was in the selector. That is what "matches are not filtered by
   * gender" turned out to be: not a missing filter, but the wrong subject.
   *
   * The gender rule itself lives in the matchmaking query, where it belongs,
   * and applies as soon as the right profile is asked about.
   */
  /**
   * What the engine puts forward, plus what the family sent over.
   *
   * A profile a relative has deliberately shared is the strongest
   * recommendation on this platform — somebody who knows both sides thought it
   * was worth a look — and it was not appearing here at all. It went to Shared
   * With Me, a screen an individual does not have, so in practice it went
   * nowhere.
   *
   * Family shares are shown first and labelled, because where a suggestion came
   * from changes how it is read: an aunt's suggestion is not a percentage, and
   * presenting it as one would be worse than not showing it.
   */
  async matchRecommendations(actor: AuthUser, profileId?: string) {
    const engine = await this.matchmaking.suggestions(actor, {
      page: 1,
      limit: 5,
      minScore: 50,
      ...(profileId ? { profileId } : {}),
    } as never);

    const shared = await this.matchmaking.familyShared(actor, profileId);
    if (shared.length === 0) return engine;

    // De-duplicated: a profile the engine also liked appears once, as the
    // family suggestion, because that is the more useful of the two framings.
    const sharedIds = new Set(shared.map((row) => row.profile.id));
    return {
      ...engine,
      data: [...shared, ...engine.data.filter((row) => !sharedIds.has(row.profile.id))],
    };
  }

  vendorRecommendations(category?: VendorCategory) {
    return this.vendors.search({ category, page: 1, limit: 5 } as never);
  }

  budgetInsight(totalBudget: number) {
    const breakdown = BUDGET_ALLOCATION.map((a) => ({
      category: a.category,
      percent: a.percent,
      amount: Math.round((totalBudget * a.percent) / 100),
    }));
    return { totalBudget, breakdown };
  }

  async assistant(question: string) {
    const answer = await this.ai.complete(question);
    return { question, answer };
  }
}
