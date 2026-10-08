// Number and date formatting shared across the app, so a value reads the same
// everywhere: signed, colored by direction, compact where space is short.

const brlFull = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL'
});

const brlSigned = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL',
	signDisplay: 'exceptZero'
});

const brlCompactFormat = new Intl.NumberFormat('pt-BR', {
	style: 'currency',
	currency: 'BRL',
	notation: 'compact',
	maximumFractionDigits: 2
});

export function brl(value: number): string {
	return brlFull.format(value);
}

// Amount in a given currency ("US$ 10,00"); BRL when the row has none.
export function money(value: number, currency = 'BRL'): string {
	return value.toLocaleString('pt-BR', { style: 'currency', currency });
}

// "+R$ 1.234,56" / "-R$ 1.234,56": a gain never reads like a balance.
export function signedBrl(value: number): string {
	return brlSigned.format(value);
}

// "+184" / "-184": a quantity gap reads as a movement, not as a total. Cotas
// can be fractional (fundos, desdobros), so the decimals are kept when they
// exist and dropped when they do not.
export function signedQuantity(value: number): string {
	return value.toLocaleString('pt-BR', {
		signDisplay: 'exceptZero',
		maximumFractionDigits: 8
	});
}

// "R$ 1,48 mi" for headline cards; below ten thousand the full number is
// shorter and clearer, so it falls back.
export function brlCompact(value: number): string {
	return Math.abs(value) < 10_000
		? brlFull.format(value)
		: brlCompactFormat.format(value);
}

export function pct(rate: number | null, digits = 2): string {
	return rate === null ? '—' : `${(rate * 100).toFixed(digits)}%`;
}

export function signedPct(rate: number | null, digits = 2): string {
	if (rate === null) return '—';
	const sign = rate > 0 ? '+' : '';
	return `${sign}${(rate * 100).toFixed(digits)}%`;
}

export function percentOfCdi(value: number | null, digits = 0): string {
	return value === null ? '—' : `${value.toFixed(digits)}% do CDI`;
}

// "Agosto de 2026" from "2026-08".
export function monthName(key: string): string {
	const [year, month] = key.split('-').map(Number);
	return new Date(year, month - 1, 1)
		.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
		.replace(/^./, (c) => c.toUpperCase());
}

// "agosto de 2026" from "2026-08". "all" and empty keys get a label of their
// own, so filter dropdowns can pass the raw value.
export function formatMonthLong(key: string): string {
	if (key === 'all') return 'Todos os meses';
	const [year, month] = key.split('-').map(Number);
	if (!year || !month) return key || 'Sem mês';
	return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
		month: 'long',
		year: 'numeric'
	});
}

// "Ago/26" for tight spaces. Built by hand: Intl gives "ago. de 26" here.
const MONTHS_SHORT = [
	'Jan',
	'Fev',
	'Mar',
	'Abr',
	'Mai',
	'Jun',
	'Jul',
	'Ago',
	'Set',
	'Out',
	'Nov',
	'Dez'
];
export function monthShort(key: string): string {
	const [year, month] = key.split('-').map(Number);
	return `${MONTHS_SHORT[month - 1] ?? '?'}/${String(year).slice(-2)}`;
}

// "Seg, 31/08" from "2026-08-31". Built by hand for the same reason.
const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export function dayShort(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return `${WEEKDAYS_SHORT[weekday]}, ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

// "31/08/2026" from "2026-08-31".
export function dateBr(iso: string | null | undefined): string {
	if (!iso) return '—';
	const [year, month, day] = iso.slice(0, 10).split('-');
	return `${day}/${month}/${year}`;
}

// "12/09" from "2026-09-12", for tables where the year is implied.
export function dateShort(iso: string | null | undefined): string {
	if (!iso) return '—';
	const [, month, day] = iso.slice(0, 10).split('-');
	return `${day}/${month}`;
}

// Text color for a signed amount: green up, red down, muted for zero/unknown.
export function gainClass(value: number | null): string {
	if (value === null) return 'text-gray-400';
	if (value > 0.005) return 'text-emerald-700';
	if (value < -0.005) return 'text-red-700';
	return 'text-gray-600';
}

// Text color for a "% of CDI" figure: at or above the benchmark is green,
// positive but below is amber, negative is red.
export function cdiClass(value: number | null): string {
	if (value === null) return 'text-gray-400';
	if (value >= 100) return 'text-emerald-700';
	if (value >= 0) return 'text-amber-700';
	return 'text-red-700';
}
