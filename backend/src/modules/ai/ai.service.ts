import { Inject, Injectable } from '@nestjs/common';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { VendorsService } from '../vendors/vendors.service';
import { VendorCategory } from '../../common/enums';
import { AI_PROVIDER, AiProvider } from './ai.provider';

/**
 * WOW Genie, orchestrates existing platform data into recommendations and
 * assistant responses. Match/vendor recos reuse the real engines; budget
 * insights are rule-based; free-form Q&A goes through the pluggable AiProvider.
 */
const BUDGET_ALLOCATION: { category: string; percent: number }[] = [
  { category: 'Venue', percent: 30 },
  { category: 'Catering', percent: 25 },
  { category: 'Decor', percent: 12 },
  { category: 'Photography', percent: 10 },
  { category: 'Attire & Jewellery', percent: 10 },
  { category: 'Makeup', percent: 5 },
  { category: 'Entertainment', percent: 5 },
  { category: 'Miscellaneous', percent: 3 },
];

@Injectable()
export class AiService {
  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly vendors: VendorsService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  matchRecommendations(userId: string) {
    return this.matchmaking.suggestions(userId, 1, 5);
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
