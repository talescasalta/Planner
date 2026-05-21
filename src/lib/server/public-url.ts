import { env } from '$env/dynamic/public';

export function publicOrigin(requestOrigin: string): string {
	const configured = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
	return configured || requestOrigin;
}

export function publicUrl(requestOrigin: string, path: string): string {
	return new URL(path, publicOrigin(requestOrigin)).toString();
}
