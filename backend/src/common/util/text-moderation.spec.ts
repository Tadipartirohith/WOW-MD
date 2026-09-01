import { screenText } from './text-moderation';

/**
 * The bias here is deliberate and worth stating: this screen must be far more
 * willing to let something through than to hold it.
 *
 * A held review costs a delay. A wrongly held one costs a complaint about a
 * vendor — which is the review with the strongest reason to exist and the
 * strongest commercial incentive to disappear. So the tests that matter most
 * are the negatives: angry, damning, unhappy reviews that must publish.
 */
describe('screenText', () => {
  const passes = (text: string | null) => expect(screenText(text).hold).toBe(false);
  const holds = (text: string) => expect(screenText(text).hold).toBe(true);

  it('lets an ordinary review through', () => {
    passes('Lovely food and they turned up on time. Would book again.');
    passes('');
    passes(null);
  });

  it('lets a furious review through, which is the whole point', () => {
    // Every one of these is somebody a platform should want to hear from.
    passes('Absolutely terrible. They were four hours late and the food was cold.');
    passes('Worst experience of our wedding. Avoid this vendor at all costs.');
    passes('They took the deposit and stopped answering the phone. Disgraceful service.');
    passes('I would not recommend them to my worst enemy.');
    passes('Damaged our booking and refused a refund. We are taking this further.');
  });

  it('does not trip on innocent words that contain rude ones', () => {
    // The classic failure mode of a word list, and the one that quietly
    // deletes real reviews.
    passes('The venue is in Scunthorpe and the staff were wonderful.');
    passes('We booked the assassin-themed photo shoot, which was great fun.');
    passes('Their analysis of the seating plan saved us.');
  });

  it('holds abuse', () => {
    holds('These people are complete bastards');
    holds('what a bunch of idiots');
  });

  it('holds it through the usual padding and substitution', () => {
    holds('you are a b i t c h');
    holds('total sh1t service');
  });

  it('holds a threat, which is about a person rather than a service', () => {
    holds('I will find the owner and beat him');
    holds('wait and see what happens to your shop');
  });

  it('holds sustained shouting, but not an emphasised word', () => {
    passes('AVOID. They cancelled on the day.');
    passes('OK service, nothing special about it at all really.');
    holds('THIS COMPANY RUINED THE ENTIRE WEDDING AND NOBODY ANSWERED THE PHONE');
  });

  it('says why, because the reason is shown to a person', () => {
    expect(screenText('you are a bastard').reason).toContain('abusive');
    expect(screenText('I will beat you').reason).toContain('threat');
    expect(screenText('ordinary text').reason).toBeNull();
  });
});
