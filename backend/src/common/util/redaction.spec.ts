import { redactContacts } from './redaction';

describe('redactContacts', () => {
  it('leaves an ordinary message alone', () => {
    const { text, redactions } = redactContacts('Lovely to hear from you. Shall we meet Sunday?');
    expect(text).toBe('Lovely to hear from you. Shall we meet Sunday?');
    expect(redactions).toBe(0);
  });

  it.each([
    ['9876543210', 'a bare mobile number'],
    ['+91 98765 43210', 'a spaced number with a country code'],
    ['98765-43210', 'a dashed number'],
    ['0091 9876543210', 'the 00 country prefix'],
  ])('strips %s (%s)', (number) => {
    const { text, redactions } = redactContacts(`Call me on ${number} please`);
    expect(text).not.toContain('9876');
    expect(redactions).toBeGreaterThan(0);
  });

  it('strips an email address without leaving half of it behind', () => {
    const { text } = redactContacts('Write to priya.sharma99@example.com any time');
    expect(text).toBe('Write to [contact removed] any time');
  });

  it('catches a number spelled out in words', () => {
    const { text } = redactContacts('my number is nine eight seven six five four three two one zero');
    expect(text).not.toContain('seven');
  });

  it('catches an attempt to move to another app', () => {
    const { text } = redactContacts('ping me on whatsapp @priya_s');
    expect(text).not.toContain('priya_s');
  });

  it('counts each substitution, so repeated attempts are visible', () => {
    const { redactions } = redactContacts('9876543210 or a@b.com');
    expect(redactions).toBe(2);
  });

  /*
   * Alternating figures and words is the obvious next thing to try once
   * somebody notices that neither form works on its own, and it went straight
   * through: the figures broke the spelled run into pieces too short to match,
   * and the words broke the digit run the same way.
   */
  it('catches a number written half in words and half in figures', () => {
    const { text, redactions } = redactContacts('nine eight 7 six 5 four 3 two 1 zero');
    expect(text).toBe('[contact removed]');
    expect(redactions).toBe(1);
  });

  it('takes the whole number, not the tail of it', () => {
    // Redacting from the middle leaves the first digits sitting in the message
    // beside a notice saying the number was removed.
    const { text } = redactContacts('my number is nine eight 76 five four three two one zero');
    expect(text).toBe('my number is [contact removed]');
  });

  it('leaves a run that is not long enough to be a number', () => {
    const { text, redactions } = redactContacts('table 12 seats four, table 3 seats two');
    expect(text).toBe('table 12 seats four, table 3 seats two');
    expect(redactions).toBe(0);
  });

  it('does not mangle ordinary numbers in a sentence', () => {
    const { text, redactions } = redactContacts('We expect 250 guests and a budget of 400000');
    expect(text).toBe('We expect 250 guests and a budget of 400000');
    expect(redactions).toBe(0);
  });
});
