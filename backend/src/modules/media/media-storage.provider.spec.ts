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
