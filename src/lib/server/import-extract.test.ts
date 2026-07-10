import { describe, expect, it } from 'vitest';
import { detectImageMimeType } from './import-extract';

describe('detectImageMimeType', () => {
	it('detects PNG, JPEG and WebP from their file signatures', () => {
		expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
		expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(detectImageMimeType(Buffer.from('RIFF....WEBP', 'ascii'))).toBe('image/webp');
	});

	it('rejects files that do not contain a supported image signature', () => {
		expect(detectImageMimeType(Buffer.from('not an image'))).toBeNull();
	});
});
