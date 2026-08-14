export const DITHERING_GROUPS = [
	{
		label: 'Error diffusion',
		options: [
			{ value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
			{ value: 'jarvis-judice-ninke', label: 'Jarvis, Judice & Ninke' },
			{ value: 'stucki', label: 'Stucki' },
			{ value: 'burkes', label: 'Burkes' },
			{ value: 'sierra', label: 'Sierra' },
			{ value: 'two-row-sierra', label: 'Two-row Sierra' },
			{ value: 'sierra-lite', label: 'Sierra Filter Lite' },
			{ value: 'atkinson', label: 'Atkinson' },
		],
	},
	{
		label: 'Pattern-based dithering',
		options: [
			{ value: 'pattern', label: 'Pattern' },
			{ value: 'ordered-halftone', label: 'Ordered (Halftone)' },
			{ value: 'ordered-bayer', label: 'Ordered (Bayer)' },
			{ value: 'ordered-void-cluster', label: 'Ordered (Void-and-cluster)' },
			{ value: 'random', label: 'Random' },
			{ value: 'gradient-based', label: 'Gradient-based' },
		],
	},
	{
		label: 'Non-kernel dithering',
		options: [
			{ value: 'threshold', label: 'Threshold' },
			{ value: 'riemersma', label: 'Riemersma' },
			{ value: 'lattice-boltzmann', label: 'Lattice-Boltzmann' },
			{ value: 'electrostatic', label: 'Electrostatic halftoning' },
		],
	},
];

export const DITHERING_OPTIONS = DITHERING_GROUPS.flatMap((group) => group.options);
