/**
 * What WOW Genie knows without an LLM.
 *
 * The mock provider used to echo the question back — "Here's guidance based on
 * 'How do I plan for 30 guests'. Set AI_PROVIDER=openai for full AI responses."
 * That is not an answer. It is a note to the operator printed where the user's
 * answer should be, and it was reported as wrong because it is wrong: the
 * person asked a question and was told about an environment variable.
 *
 * A deterministic answer to the questions people actually ask is better than a
 * placeholder in every way that matters here. It is correct, it costs nothing,
 * it works offline and in tests, and — unlike a model — it agrees with the rest
 * of the platform, because it is built from the same numbers the Budget
 * Insights panel beside it uses.
 *
 * Where it genuinely does not know, it says so and points at somebody who does,
 * rather than inventing something.
 */

export interface GenieTopic {
  /** Words that mean somebody is asking about this. */
  matches: RegExp;
  /** Built from the question, so a number in the question reaches the answer. */
  answer: (question: string) => string;
}

/** The first number in a question, when there is one. */
function firstNumber(question: string): number | null {
  const match = question.replace(/,/g, '').match(/\b(\d{2,9})\b/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

const rupees = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));

export const BUDGET_ALLOCATION: { category: string; percent: number }[] = [
  { category: 'Venue', percent: 30 },
  { category: 'Catering', percent: 25 },
  { category: 'Decor', percent: 12 },
  { category: 'Photography', percent: 10 },
  { category: 'Attire & Jewellery', percent: 10 },
  { category: 'Makeup', percent: 5 },
  { category: 'Entertainment', percent: 5 },
  { category: 'Miscellaneous', percent: 3 },
];

export const GENIE_TOPICS: GenieTopic[] = [
  {
    // "How do I plan for 30 guests" — the question in the report.
    matches: /\bguest|\bpeople\b|\bpax\b|\battend/i,
    answer: (question) => {
      const guests = firstNumber(question) ?? 100;
      const plates = Math.ceil(guests * 1.1);
      const tables = Math.ceil(guests / 10);
      const size =
        guests <= 50
          ? 'This is an intimate wedding. A banquet hall or a large home works; you do not need a convention centre, and most venues will have a minimum-guarantee clause that costs you more than the guests would.'
          : guests <= 250
            ? 'This is the ordinary size. Almost every venue and caterer on WOW quotes comfortably at this number.'
            : 'This is a large wedding. Book the venue and caterer first — at this size they are the constraint, and everything else follows what they can take.';

      return [
        `Planning for about ${guests} guests.`,
        '',
        size,
        '',
        'What that means in practice:',
        `• Cater for ${plates} plates, not ${guests}. Roughly a tenth more than the head count is the usual allowance for guests who bring somebody and for second helpings.`,
        `• About ${tables} tables of ten for a seated meal, or half that if it is a buffet with standing space.`,
        `• Invitations go to households, not heads. Track both — WOW's Events page counts invitations and people separately for exactly this reason, because "40 invitations" and "40 guests" are rarely the same wedding.`,
        '',
        'The order that saves the most trouble: fix the date, then the venue, then the caterer, then everything else. Photography and decor can be booked late; a good venue on a good date cannot.',
        '',
        'Add each day of the wedding under Events, add your guests once, and invite them per day — the RSVP counts then tell you how many are actually coming to each.',
      ].join('\n');
    },
  },
  {
    matches: /\bbudget|\bcost|\bspend|\bafford|\bprice\b/i,
    answer: (question) => {
      const total = firstNumber(question);
      const lines = BUDGET_ALLOCATION.map(
        (a) =>
          `• ${a.category} — ${a.percent}%${total ? ` (${rupees((total * a.percent) / 100)})` : ''}`,
      );
      return [
        total
          ? `A ${rupees(total)} wedding, split the way most weddings actually split:`
          : 'A wedding budget usually splits like this:',
        '',
        ...lines,
        '',
        'Venue and catering are more than half of it. If the total has to come down, that is where it comes down — a smaller guest list reduces both at once and reduces nothing else.',
        '',
        'Two things worth holding back: about 5% for the things nobody budgets for, and the final vendor payment. WOW holds payments in escrow and releases them in three parts, so the last one is still yours until the work is done.',
        total ? '' : 'Put your total into Budget Insights on this page for the figures.',
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
  {
    matches: /\bvenue|\bhall\b|\bbanquet|\blawn\b|\bresort\b/i,
    answer: () =>
      [
        'Choosing a venue.',
        '',
        'Ask these before the price:',
        '• What is the guaranteed minimum — the number you pay for whether or not they come?',
        '• Is outside catering allowed, or is theirs the only option? This decides most of the rest of your budget.',
        '• How late can the music run? Most cities have a legal cut-off, and it is the venue that gets fined.',
        '• Parking, and how far from the entrance.',
        '• What happens to the deposit if the date moves.',
        '',
        'Visit at the time of day your event will actually run. A lawn that is lovely at four in the afternoon is a different place at eight in the evening.',
        '',
        'Vendors on WOW are visited by a verification officer at their registered address before they can take a booking, so a listing you see here has been seen by somebody.',
      ].join('\n'),
  },
  {
    matches: /\bcater|\bfood\b|\bmenu\b|\bplate\b|\bmeal/i,
    answer: (question) => {
      const guests = firstNumber(question);
      return [
        'Catering.',
        '',
        guests
          ? `For ${guests} guests, quote for about ${Math.ceil(guests * 1.1)} plates.`
          : 'Quote for about a tenth more plates than your head count.',
        '',
        '• Fix the per-plate rate and what is in it, in writing. "Starting at" is not a price — ask what the plate actually costs with the menu you want.',
        '• Count the vegetarian requirement honestly and early; it is usually higher than the family estimates.',
        '• Ask who supplies service staff, and how many per table.',
        '• Live counters are priced separately almost everywhere.',
        '',
        'On WOW a caterer states their price per plate, per event or per day — check which, because ₹30,000 means very different things across those three.',
      ].join('\n');
    },
  },
  {
    matches: /\bphotograph|\bvideo|\bfilm\b|\balbum\b/i,
    answer: () =>
      [
        'Photography and video.',
        '',
        '• Ask for one complete wedding, start to finish — not a highlights reel. A showreel is the best forty seconds of a hundred weddings.',
        '• Confirm which photographer is actually shooting yours. Studios sell the founder and send a team.',
        '• Agree the delivery date and the number of edited images in writing.',
        '• Ask who holds the raw files, and for how long.',
        '',
        'Book after the venue and caterer, not before. Good photographers are available later than good venues are.',
      ].join('\n'),
  },
  {
    matches: /\btimeline|\bschedule\b|\bhow (long|far|early)|\bwhen should|\bmonths?\b|\bplanning\b/i,
    answer: () =>
      [
        'A working timeline, counting back from the wedding day.',
        '',
        '• 6–9 months — fix the date, book the venue, book the caterer. These two are the constraint.',
        '• 4–6 months — photography, decor, the invitation, and the guest list in writing.',
        '• 3 months — attire and jewellery, makeup, entertainment.',
        '• 6–8 weeks — send the invitations and start chasing RSVPs.',
        '• 3–4 weeks — final head count to the caterer, seating, travel and rooms for anyone coming from out of town.',
        '• 1 week — confirm every vendor in writing, and give one person the job of answering their calls on the day.',
        '',
        'Three months is enough time for a wedding if the venue is available. Everything else can be compressed; that cannot.',
      ].join('\n'),
  },
  {
    matches: /\bhoneymoon|\btrip\b|\btravel\b/i,
    answer: () =>
      [
        'Honeymoon.',
        '',
        'Book it after the wedding date is fixed and before you are exhausted — the week after the wedding is the worst time to plan anything.',
        '',
        '• Leave at least a day between the last function and the flight.',
        '• Check passport validity now: most countries want six months beyond your return date, and a name change after the wedding takes longer than people expect. Travel on the passport you have.',
        '',
        'The Honeymoon page holds the plan, day by day, and you can start it with nothing filled in.',
      ].join('\n'),
  },
  {
    matches: /\binvit|\brsvp\b|\bguest list\b/i,
    answer: () =>
      [
        'Invitations and RSVPs.',
        '',
        '• Send six to eight weeks out. Earlier and people forget; later and they have plans.',
        '• Invite households, and record how many people each one is. This is the number the caterer needs and the number that is always wrong.',
        '• Chase the ones who have not answered two weeks before, by phone. Nobody replies to a second card.',
        '• Expect around one in ten to change their answer in the last week.',
        '',
        'On WOW, add each day of the wedding under Events, add every guest once, and invite them to the days that apply. The RSVP cards then show coming, not coming, and not yet answered for each day separately.',
      ].join('\n'),
  },
  {
    matches: /\bmuhurat|\bhoroscope|\bkundli|\bmatch(ing)? (the )?(chart|star)|\bgothram|\brashi\b/i,
    answer: () =>
      [
        'Horoscope matching.',
        '',
        'WOW records the chart — rashi, star, padam, gothram, kuja dosham and the time of birth — and lets each family say what they expect: required, preferred, or no preference. It does not compute a guna score and does not pretend to. That reading belongs to your family priest, and it is not a thing to take from software.',
        '',
        'What the platform does do is make sure both sides have the same information before anybody spends time: the chart is attached to the biodata, and partner preferences record whether it matters to you at all.',
      ].join('\n'),
  },
  {
    matches: /\bvendor|\bbook(ing)?\b|\bpay|\bescrow|\brefund|\bcancel/i,
    answer: () =>
      [
        'Booking and paying a vendor on WOW.',
        '',
        '• Every vendor is visited at their registered address by a verification officer before they can take a booking.',
        '• Payment is held in escrow and released in three parts: something to hold the date, something as the event approaches, the balance on delivery. The last part is still yours until the work is done.',
        '• A dispute freezes what is still held while somebody looks at it.',
        '• Cancellation terms are the vendor\'s and are shown on the quotation before you accept it. Read that part.',
        '',
        'Book from the Vendors page, or from a specific day under Events so the booking is attached to the right function.',
      ].join('\n'),
  },
];

/**
 * The answer for a question nothing matched.
 *
 * Says what it can help with rather than apologising, and does not pretend the
 * question was understood.
 */
export const GENIE_FALLBACK = [
  'I can help with the parts of a wedding that have numbers in them:',
  '',
  '• Guest counts, and what they mean for catering and seating',
  '• Budgets, and where the money actually goes',
  '• Choosing a venue, caterer or photographer, and what to ask them',
  '• A month-by-month timeline',
  '• Invitations and chasing RSVPs',
  '• How booking and payment work on WOW',
  '',
  'Ask about any of those and I will be specific. For anything about your own match or your own family, your agent knows more than I do.',
].join('\n');

/** Picks the topic a question is about, or null. */
export function answerFor(question: string): string | null {
  const topic = GENIE_TOPICS.find((t) => t.matches.test(question));
  return topic ? topic.answer(question) : null;
}
