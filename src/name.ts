import { SproutError } from "./errors.ts";

const maxLength = 40;

/**
 * Turns any text into a name by the name rules, which run in order. Text with
 * no `a-z` or `0-9` left after the rules is an error.
 */
export function toName(text: string): string {
	const name = tryName(text);
	if (name === undefined) {
		throw new SproutError(`'${text}' has no a-z or 0-9 to make a name from`);
	}
	return name;
}

/** Like `toName`, but text with nothing to make a name from gives `undefined`. */
export function tryName(text: string): string | undefined {
	const name = cut(
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/\p{M}/gu, "")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, ""),
	);
	return name === "" ? undefined : name;
}

/**
 * Shortens a name over 40 characters to whole words at a dash, keeping at most
 * 40 characters. A name with no dash in reach is cut at 40.
 */
function cut(name: string): string {
	if (name.length <= maxLength) return name;
	const dash = name.lastIndexOf("-", maxLength);
	return name.slice(0, dash === -1 ? maxLength : dash);
}
