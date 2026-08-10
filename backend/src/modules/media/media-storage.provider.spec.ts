import { MediaStorageProvider } from './media-storage.provider';
import { AppConfigService } from '../../config/app-config.service';

const cfgWith = (media: Record<string, unknown>) =>
  ({ media }) as unknown as AppConfigService;

describe('MediaStorageProvider', () => {
  it('returns a mock upload URL when provider is mock', () => {
    const p = new MediaStorageProvider(cfgWith({ storageProvider: 'mock', cdnBaseUrl: '' }));
    const r = p.presign('user-1', 'photo.jpg');
    expect(r.uploadUrl).toContain('mock=put');
    expect(r.key).toMatch(/^uploads\/user-1\//);
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
