import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Visual showcase routes exist only while developing.
export const load = () => {
	if (!dev) error(404, 'Not found');
	return {};
};
