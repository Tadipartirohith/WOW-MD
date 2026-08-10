import { paymentProviderFactory } from '../modules/bookings/payment.provider';
import { aiProviderFactory } from '../modules/ai/ai.provider';
import { AppConfigService } from '../config/app-config.service';

// Verifies the config-driven factories pick the right implementation.
describe('provider selection (config-driven)', () => {
  const mockPay = { tag: 'mock' } as never;
  const razorpay = { tag: 'razorpay' } as never;
  const mockAi = { tag: 'mock-ai' } as never;
  const openai = { tag: 'openai' } as never;

  it('payment factory selects mock by default and razorpay when configured', () => {
    const asMock = { payments: { provider: 'mock' } } as unknown as AppConfigService;
    const asRzp = { payments: { provider: 'razorpay' } } as unknown as AppConfigService;
    expect(paymentProviderFactory.useFactory(asMock, mockPay, razorpay)).toBe(mockPay);
    expect(paymentProviderFactory.useFactory(asRzp, mockPay, razorpay)).toBe(razorpay);
  });

  it('ai factory selects mock by default and openai when configured', () => {
    const asMock = { ai: { provider: 'mock' } } as unknown as AppConfigService;
    const asOpenAi = { ai: { provider: 'openai' } } as unknown as AppConfigService;
    expect(aiProviderFactory.useFactory(asMock, mockAi, openai)).toBe(mockAi);
    expect(aiProviderFactory.useFactory(asOpenAi, mockAi, openai)).toBe(openai);
  });
});
