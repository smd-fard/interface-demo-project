/** How the steps ended: all completed, or a runtime condition resolved to a business outcome (steps 35–37). */
export type StepRunResult =
	| { readonly kind: 'completed' }
	| {
			readonly kind: 'business_outcome';
			readonly code: string;
			/** Unredacted here; the ResultBuilder redacts it before the result is returned or written. */
			readonly message: string;
			readonly stepId: string;
	  };
