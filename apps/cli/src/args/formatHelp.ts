import type { CommandSpec, OptionSpec } from './CommandSpec.js';

function flagLabel(name: string, option: OptionSpec): string {
	const flag = option.negatable === true ? `--[no-]${name}` : `--${name}`;
	const short = option.short === undefined ? '' : `-${option.short}, `;
	const value = option.type === 'string' ? ` <${option.valueName ?? 'value'}>` : '';
	return `${short}${flag}${value}`;
}

function describeOption(option: OptionSpec): string {
	const extras: string[] = [];
	if (option.multiple === true) extras.push('repeatable');
	if (typeof option.default === 'boolean') extras.push(`default: ${option.default ? 'on' : 'off'}`);
	else if (option.default !== undefined) extras.push(`default: ${option.default}`);
	return extras.length === 0 ? option.description : `${option.description} (${extras.join('; ')})`;
}

/** The `--help` text of a command, built from its spec. */
export function formatHelp(spec: CommandSpec): string {
	const entries = [
		...Object.entries(spec.options).map(([name, option]) => [flagLabel(name, option), describeOption(option)] as const),
		['-h, --help', 'Show this help.'] as const,
	];
	const width = Math.max(...entries.map(([label]) => label.length)) + 2;
	const lines = [`${spec.summary}`, '', 'Usage:', `  ${spec.usage}`, '', 'Flags:'];
	for (const [label, text] of entries) lines.push(`  ${label.padEnd(width)}${text}`);
	if (spec.examples !== undefined && spec.examples.length > 0) {
		lines.push('', 'Examples:', ...spec.examples.map((example) => `  ${example}`));
	}
	if (spec.notes !== undefined && spec.notes.length > 0) {
		for (const note of spec.notes) lines.push('', note);
	}
	return lines.join('\n');
}
