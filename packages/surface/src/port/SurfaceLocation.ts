import type { FramePath } from './Observation.js';

/** Where the surface is: the top document and every frame (the content frame of a frameset included). */
export interface SurfaceLocation {
	readonly url: string;
	readonly title: string;
	readonly frames: readonly {
		readonly path: FramePath;
		readonly name: string;
		readonly url: string;
		readonly title: string;
	}[];
}
