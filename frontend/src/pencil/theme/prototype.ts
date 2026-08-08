export default {
	slots: {
		root: "fixed inset-0 flex items-center justify-center overflow-hidden bg-canvas",
		stage: "relative overflow-hidden shadow-2xl",
	},
	variants: {
		interactive: {
			true: { stage: "cursor-pointer" },
			false: { stage: "cursor-default" },
		},
	},
	defaultVariants: {
		interactive: false as const,
	},
};
