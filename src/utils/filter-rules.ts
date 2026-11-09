import type { FilterRule } from "@/database/settings";

// App-only Include/Exclude rules. They decide whether the app shows an
// inbound email — and, because a hidden email is never read in the app,
// whether the server spends AI on it or pushes it. The REST API and the web
// dashboard never filter by them.
//
// Semantics:
//   - any matching `exclude` rule hides the email;
//   - if at least one `include` rule exists, only emails matching one are shown.
// Clients evaluating the same rules locally must follow exactly this logic.

// `pattern` is an exact address ("a@b.com") or a domain ("@b.com" / "b.com"),
// which also matches subdomains (bounce@mail.b.com). Case-insensitive.
export function matchesPattern(address: string, pattern: string): boolean {
	// Accept name-addr form ("Name <a@b.com>") as well as bare addresses.
	const value = (/<([^>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
	const rule = pattern.trim().toLowerCase();
	if (!rule || !value) return false;

	if (rule.startsWith("@") || !rule.includes("@")) {
		const domain = rule.replace(/^@/, "");
		const host = value.slice(value.lastIndexOf("@") + 1);
		return host === domain || host.endsWith(`.${domain}`);
	}
	return value === rule;
}

export function isHiddenInApp(
	rules: FilterRule[],
	email: { from_address: string; to_address: string },
): boolean {
	const hits = (rule: FilterRule) =>
		matchesPattern(rule.field === "from" ? email.from_address : email.to_address, rule.pattern);

	if (rules.some((rule) => rule.mode === "exclude" && hits(rule))) return true;
	const includes = rules.filter((rule) => rule.mode === "include");
	return includes.length > 0 && !includes.some(hits);
}
