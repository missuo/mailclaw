export function OK<T>(data: T) {
	return { success: true as const, data };
}

export function ERR(code: string, message: string) {
	return { success: false as const, error: { code, message } };
}
