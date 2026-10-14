// Privacy mode toggle. static/privacy.js marks the amounts and restores the
// saved choice before the first paint; this only flips the <html> class and
// remembers it on this device, so every toggle on screen stays in sync.

const STORAGE_KEY = 'planner:privacy'; // same key as static/privacy.js

class PrivacyStore {
	on = $state(false);

	// The server render cannot know the saved choice; read it once mounted.
	sync() {
		this.on = document.documentElement.classList.contains('privacy');
	}

	toggle() {
		this.on = !this.on;
		document.documentElement.classList.toggle('privacy', this.on);
		try {
			localStorage.setItem(STORAGE_KEY, this.on ? '1' : '0');
		} catch {
			// Storage blocked: the choice lasts until the page reloads.
		}
	}
}

export const privacy = new PrivacyStore();
