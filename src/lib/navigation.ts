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

export type NavItem = {
	href: string;
	label: string;
	shortLabel?: string;
	icon: typeof LayoutDashboard;
	primary: boolean;
};

export const NAV_ITEMS: NavItem[] = [
	{ href: '/app', label: 'Dashboard', icon: LayoutDashboard, primary: true },
	{ href: '/app/groups', label: 'Grupos', icon: Users, primary: false },
	{
		href: '/app/transactions',
		label: 'Transações',
		icon: Receipt,
		primary: true
	},
	{
		href: '/app/installments',
		label: 'Parcelas',
		icon: Repeat,
		primary: false
	},
	{
		href: '/app/categories',
		label: 'Categorias',
		icon: FolderTree,
		primary: false
	},
	{
		href: '/app/imports',
		label: 'Importar fatura',
		shortLabel: 'Importar',
		icon: ArrowDownToLine,
		primary: true
	},
	{
		href: '/app/investments',
		label: 'Investimentos',
		icon: TrendingUp,
		primary: false
	},
	{ href: '/app/review', label: 'Revisão', icon: ListChecks, primary: true },
	{ href: '/app/rules', label: 'Regras', icon: WandSparkles, primary: false },
	{
		href: '/app/settings',
		label: 'Configurações',
		icon: Settings,
		primary: false
	}
];

export function isActive(pathname: string, href: string): boolean {
	if (href === '/app') return pathname === '/app';
	return pathname === href || pathname.startsWith(`${href}/`);
}
