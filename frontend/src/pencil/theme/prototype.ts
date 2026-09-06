export default {
	slots: {
		// Root is the scroll container. Centering must NOT live here: flex-centering an
		// overflowing child on the scroll container itself clips its top/left edge. Instead the
		// inner wrapper grows with the stage (h-max/w-max) while staying at least viewport-sized
		// (min-h/min-w), so small stages center and oversized stages scroll fully into view.
		root: "fixed inset-0 overflow-auto bg-canvas",
		// p-12 = 48px, keep in sync with STAGE_MARGIN in PresentView.vue.
		scroll: "flex h-max min-h-full w-max min-w-full items-center justify-center p-12",
		stage: "relative shrink-0 overflow-hidden shadow-2xl",
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
