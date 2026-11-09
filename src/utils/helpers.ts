export function now(): number {
	return Math.floor(Date.now() / 1000);
}

export function base64ToUint8Array(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// Splits RFC 5322 name-addr ("Vincent Yang <me@uid.si>") into its parts.
export function parseNameAddr(value: string): { name: string; email: string } {
	const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
	if (!match) return { name: "", email: value.trim() };
	return { name: match[1].replace(/^"(.*)"$/, "$1"), email: match[2].trim() };
}

export function parseTimestamp(value: string): number | null {
	// Try Unix timestamp
	const num = Number(value);
	if (!Number.isNaN(num) && num > 0) {
		return num;
	}
	// Try ISO 8601 date string
	const date = new Date(value);
	if (!Number.isNaN(date.getTime())) {
		return Math.floor(date.getTime() / 1000);
	}
	return null;
}
