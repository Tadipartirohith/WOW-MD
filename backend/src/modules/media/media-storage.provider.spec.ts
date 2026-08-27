import { MediaStorageProvider } from './media-storage.provider';
import { AppConfigService } from '../../config/app-config.service';

const cfgWith = (media: Record<string, unknown>) =>
  ({ media }) as unknown as AppConfigService;

describe('MediaStorageProvider', () => {
  it('points the mock upload at somewhere that actually serves it', () => {
    const p = new MediaStorageProvider(
      cfgWith({
        storageProvider: 'mock',
        cdnBaseUrl: '',
        mockBaseUrl: 'http://localhost:8080/api/mock-storage',
      }),
    );
    const r = p.presign('user-1', 'photo.jpg');

    expect(r.uploadUrl).toBe(`http://localhost:8080/api/mock-storage/${r.key}`);
    // The same address for both, which is the property that matters: the file
    // you PUT is the file you GET. The old marker query parameter
    // distinguished nothing and meant a client had to strip it before showing
    // the image — a rule the real provider does not have.
    expect(r.publicUrl).toBe(r.uploadUrl);
    expect(r.key).toMatch(/^uploads\/user-1\//);
  });

  /*
   * The names people actually upload.
   *
   * "It is not taking all types of images" turned out to be about the name
   * rather than the image: a filename with a space in it was refused outright,
   * and a space that reached the key would have produced a URL some clients
   * encode and others truncate. Both halves are settled here — the name is
   * accepted, and what lands in the key is safe to put in a link.
   */
  describe('the filename a real device produces', () => {
    const provider = () =>
      new MediaStorageProvider(
        cfgWith({
          storageProvider: 'mock',
          cdnBaseUrl: '',
          mockBaseUrl: 'http://localhost:8080/api/mock-storage',
        }),
      );

    it.each([
      ['WhatsApp Image 2026-08-26 at 5.28.11 PM.jpeg', 'jpeg'],
      ['pic (1).png', 'png'],
      ["Ravi's wedding.jpg", 'jpg'],
      ['IMG_20260826.jfif', 'jfif'],
      ['snap.avif', 'avif'],
      ['photo.HEIC', 'heic'],
    ])('folds %s into a key that is safe in a URL', (filename, extension) => {
      const { key, publicUrl } = provider().presign('user-1', filename);

      expect(key).toMatch(/^uploads\/user-1\/\d+-[A-Za-z0-9.-]+$/);
      expect(key.endsWith(`.${extension}`)).toBe(true);
      // Nothing in the key needs escaping, so the URL it goes into is the URL
      // that comes back.
      expect(encodeURI(publicUrl)).toBe(publicUrl);
    });

    it('keeps a name that is already safe recognisable', () => {
      expect(provider().presign('user-1', 'passport-photo.png').key).toContain('passport-photo.png');
    });

    it('does not produce an empty name from a filename with nothing usable in it', () => {
      const { key } = provider().presign('user-1', '___.jpg');
      expect(key).toMatch(/\/\d+-file\.jpg$/);
    });
  });

  it('prefers a CDN when one is configured', () => {
    const p = new MediaStorageProvider(
      cfgWith({
        storageProvider: 'mock',
        cdnBaseUrl: 'https://cdn.example.com',
        mockBaseUrl: 'http://localhost:8080/api/mock-storage',
      }),
    );
    expect(p.presign('user-1', 'photo.jpg').publicUrl).toContain('https://cdn.example.com/');
  });

  it('returns a real SigV4 presigned URL when provider is s3', () => {
    const p = new MediaStorageProvider(
      cfgWith({
        storageProvider: 's3',
        s3Bucket: 'wow-media',
        s3Region: 'ap-south-1',
        s3AccessKeyId: 'AKIAEXAMPLE',
        s3SecretAccessKey: 'secretkey',
        presignExpirySeconds: 900,
        cdnBaseUrl: '',
      }),
    );
    const r = p.presign('user-1', 'photo.jpg');
    expect(r.uploadUrl).toContain('wow-media.s3.ap-south-1.amazonaws.com');
    expect(r.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(r.uploadUrl).toContain('X-Amz-Signature=');
  });
});
