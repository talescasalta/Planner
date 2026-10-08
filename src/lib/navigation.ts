import {
	ArrowDownToLine,
	FolderTree,
	LayoutDashboard,
	ListChecks,
	Receipt,
	Repeat,
	Settings,
	TrendingUp,
	Users,
	WandSparkles
} from 'lucide-svelte';

export type NavSection = 'daily' | 'planning' | 'settings';

export type NavItem = {
	href: string;
	label: string;
	shortLabel?: string;
	icon: typeof LayoutDashboard;
	section: NavSection;
	primary: boolean;
};

export const NAV_SECTIONS: { id: NavSection; label: string }[] = [
	{ id: 'daily', label: 'Dia a dia' },
	{ id: 'planning', label: 'Planejamento' },
	{ id: 'settings', label: 'Ajustes' }
];

// Listed by section, in the order the sidebar shows them.
export const NAV_ITEMS: NavItem[] = [
	{
		href: '/app',
		label: 'Visão geral',
		icon: LayoutDashboard,
		section: 'daily',
		primary: true
	},
	{
		href: '/app/transactions',
		label: 'Transações',
		icon: Receipt,
		section: 'daily',
		primary: true
	},
	{
		href: '/app/review',
		label: 'Revisão',
		icon: ListChecks,
		section: 'daily',
		primary: true
	},
	{
		href: '/app/imports',
		label: 'Importar fatura',
		shortLabel: 'Importar',
		icon: ArrowDownToLine,
		section: 'daily',
		primary: false
	},
	{
		href: '/app/investments',
		label: 'Investimentos',
		icon: TrendingUp,
		section: 'planning',
		primary: true
	},
	{
		href: '/app/installments',
		label: 'Parcelas',
		icon: Repeat,
		section: 'planning',
		primary: false
	},
	{
		href: '/app/groups',
		label: 'Grupos',
		icon: Users,
		section: 'planning',
		primary: false
	},
	{
		href: '/app/categories',
		label: 'Categorias',
		icon: FolderTree,
		section: 'settings',
		primary: false
	},
	{
		href: '/app/rules',
		label: 'Regras',
		icon: WandSparkles,
		section: 'settings',
		primary: false
	},
	{
		href: '/app/settings',
		label: 'Configurações',
		icon: Settings,
		section: 'settings',
		primary: false
	}
];

// The bottom bar reads left to right; it is not the sidebar order.
const BOTTOM_BAR = [
	'/app',
	'/app/transactions',
	'/app/investments',
	'/app/review'
];

export const BOTTOM_BAR_ITEMS: NavItem[] = BOTTOM_BAR.flatMap((href) =>
	NAV_ITEMS.filter((item) => item.href === href)
);

export function isActive(pathname: string, href: string): boolean {
	if (href === '/app') return pathname === '/app';
	return pathname === href || pathname.startsWith(`${href}/`);
}
