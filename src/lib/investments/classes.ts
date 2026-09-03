// Asset classes as the UI names and colors them. Lives outside $lib/server so
// pages, charts and server loads share one vocabulary — a class is the same
// color in the treemap, the tables and the detail panel.

export type AssetClass =
	| 'etf'
	| 'fii'
	| 'acao'
	| 'fundo'
	| 'previdencia'
	| 'tesouro'
	| 'cdb'
	| 'lca_lci'
	| 'outro';

export const CLASS_LABELS: Record<AssetClass, string> = {
	etf: 'ETFs',
	fii: 'FIIs',
	acao: 'Ações',
	fundo: 'Fundos',
	previdencia: 'Previdência',
	tesouro: 'Tesouro Direto',
	cdb: 'CDB/RDB',
	lca_lci: 'LCA/LCI',
	outro: 'Outros'
};

export const CLASS_COLORS: Record<AssetClass, string> = {
	tesouro: '#0ea5e9',
	previdencia: '#8b5cf6',
	lca_lci: '#14b8a6',
	cdb: '#10b981',
	etf: '#6366f1',
	fundo: '#f59e0b',
	fii: '#f97316',
	acao: '#ec4899',
	outro: '#64748b'
};

export function classLabel(assetClass: string): string {
	return CLASS_LABELS[assetClass as AssetClass] ?? CLASS_LABELS.outro;
}

export function classColor(assetClass: string): string {
	return CLASS_COLORS[assetClass as AssetClass] ?? CLASS_COLORS.outro;
}
