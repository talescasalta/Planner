// Privacy mode: blurs money amounts so people nearby cannot read them.
//
// Loaded as a blocking script in <head> (app.html), before the server-rendered
// body is parsed, so the values are already blurred on the first paint. It
// marks every element whose own text holds an amount ("R$ 1.234,56",
// "US$ 10,00", "-R$ 3,1 mi") with data-private; the CSS in layout.css blurs
// those while <html> has the "privacy" class. The toggle lives in
// src/lib/privacy.ts and shares the storage key below.
(() => {
	const KEY = 'planner:privacy';
	const MONEY = /(?:R\$|US\$|[$€£¥])\s*\d/;
	const root = document.documentElement;

	try {
		root.classList.toggle('privacy', localStorage.getItem(KEY) === '1');
	} catch {
		// Storage blocked (private window): privacy starts off.
	}

	function ownTextHasMoney(el) {
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE && MONEY.test(node.data)) {
				return true;
			}
		}
		return false;
	}

	function update(el) {
		if (!el || el === root || el === document.body) return;
		if (ownTextHasMoney(el)) el.setAttribute('data-private', '');
		else if (el.hasAttribute('data-private'))
			el.removeAttribute('data-private');
	}

	function scan(el) {
		update(el);
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			if (MONEY.test(walker.currentNode.data)) {
				update(walker.currentNode.parentElement);
			}
		}
	}

	new MutationObserver((records) => {
		for (const record of records) {
			if (record.type === 'characterData') {
				update(record.target.parentElement);
				continue;
			}
			update(
				record.target.nodeType === Node.ELEMENT_NODE ? record.target : null
			);
			for (const node of record.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) scan(node);
				else if (node.nodeType === Node.TEXT_NODE) update(node.parentElement);
			}
		}
	}).observe(root, { childList: true, characterData: true, subtree: true });
})();
