/** The four manifest fields that declare dependencies. */
export const DEPENDENCY_SECTIONS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
] as const;

/** One manifest dependency field. */
export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/** A workspace as declared by its `package.json`. Missing sections are empty maps. */
export interface WorkspaceNode {
	readonly name: string;
	/** Absolute directory containing the manifest. */
	readonly dir: string;
	readonly dependencies: Readonly<Record<string, string>>;
	readonly devDependencies: Readonly<Record<string, string>>;
	readonly peerDependencies: Readonly<Record<string, string>>;
	readonly optionalDependencies: Readonly<Record<string, string>>;
}

/** Every workspace in the repo, keyed by package name. */
export type WorkspaceGraph = ReadonlyMap<string, WorkspaceNode>;
