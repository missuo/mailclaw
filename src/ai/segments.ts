// Splits an email body into translatable segments and stitches translations
// back in. Only human-readable text goes to the model: markup, inline CSS and
// <head> are kept verbatim, which cuts output tokens by an order of magnitude
// on typical HTML mail and means long emails are never truncated mid-tag.
//
// A segment is a run of text plus *inline* tags (<b>, <a>, <span>…) between
// two block boundaries, so a sentence like `Hi <b>Anna</b>, welcome` is
// translated as one unit with its tags preserved.

export interface Segmented {
	segments: string[];
	rebuild(translated: string[]): string;
}

const INLINE_TAGS = new Set([
	"a",
	"abbr",
	"b",
	"bdi",
	"bdo",
	"big",
	"cite",
	"code",
	"del",
	"dfn",
	"em",
	"font",
	"i",
	"ins",
	"kbd",
	"label",
	"mark",
	"q",
	"s",
	"samp",
	"small",
	"span",
	"strike",
	"strong",
	"sub",
	"sup",
	"time",
	"tt",
	"u",
	"var",
	"wbr",
	"o:p",
]);

// Elements whose contents are never shown as text.
const SKIP_CONTENT_TAGS = new Set(["head", "script", "style", "title", "template", "xml"]);

const TOKEN_RE =
	/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<\/?[a-zA-Z][\w:-]*(?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/g;

const HAS_LETTER = /\p{L}/u;

interface Piece {
	raw: string;
	// Inline pieces can be part of a segment; block pieces end it.
	inline: boolean;
	text: boolean;
}

function tagName(tag: string): string {
	const match = /^<\/?([a-zA-Z][\w:-]*)/.exec(tag);
	return match ? match[1].toLowerCase() : "";
}

function tokenize(html: string): Piece[] {
	const pieces: Piece[] = [];
	let last = 0;
	let skipping: string | null = null;

	for (const match of html.matchAll(TOKEN_RE)) {
		const index = match.index ?? 0;
		const tag = match[0];
		if (index > last) {
			const raw = html.slice(last, index);
			pieces.push({ raw, inline: skipping === null, text: skipping === null });
		}
		last = index + tag.length;

		const name = tagName(tag);
		const closing = tag.startsWith("</");
		if (skipping) {
			pieces.push({ raw: tag, inline: false, text: false });
			if (closing && name === skipping) skipping = null;
			continue;
		}
		if (!closing && SKIP_CONTENT_TAGS.has(name) && !tag.endsWith("/>")) {
			skipping = name;
		}
		pieces.push({ raw: tag, inline: INLINE_TAGS.has(name), text: false });
	}
	if (last < html.length) {
		pieces.push({ raw: html.slice(last), inline: skipping === null, text: skipping === null });
	}
	return pieces;
}

// Invisible preheader padding (&#847;, &zwnj;, &#8199;, zero-width chars…)
// that newsletters repeat hundreds of times. Models loop trying to copy it,
// so it is kept outside segments.
const FILLER =
	"(?:\\s|&(?:nbsp|zwnj|zwj|shy|#x?[0-9a-f]+);|[\\u00a0\\u00ad\\u034f\\u2007\\u200b-\\u200f\\u2060\\ufeff])";
const EDGE_RE = new RegExp(`^(${FILLER}*)([\\s\\S]*?)(${FILLER}*)$`, "i");
const PLACEHOLDER_RE = /<\/?g\d+\/?>/g;
const VOID_TAGS = new Set(["br", "wbr", "img"]);

interface Segment {
	// Text sent to the model, inline tags replaced by <gN>…</gN> / <gN/>.
	text: string;
	// Original markup of the same span, used when a translation is unusable.
	original: string;
	// Placeholder → original tag.
	tags: Map<string, string>;
}

function placeholdersOf(text: string): string {
	return (text.match(PLACEHOLDER_RE) ?? []).sort().join("");
}

// Replaces inline tags with short placeholders so long attributes (tracking
// URLs, inline CSS) never reach the model and cannot be altered by it.
function toSegment(pieces: Piece[]): Segment {
	const tags = new Map<string, string>();
	const open: { name: string; id: number }[] = [];
	let next = 1;
	let text = "";
	for (const piece of pieces) {
		if (piece.text) {
			text += piece.raw;
			continue;
		}
		const name = tagName(piece.raw);
		let placeholder: string;
		if (piece.raw.startsWith("</")) {
			const index = open.map((o) => o.name).lastIndexOf(name);
			if (index >= 0) {
				placeholder = `</g${open[index].id}>`;
				open.splice(index, 1);
			} else {
				placeholder = `<g${next++}/>`;
			}
		} else if (VOID_TAGS.has(name) || piece.raw.endsWith("/>")) {
			placeholder = `<g${next++}/>`;
		} else {
			const id = next++;
			open.push({ name, id });
			placeholder = `<g${id}>`;
		}
		tags.set(placeholder, piece.raw);
		text += placeholder;
	}
	return { text, original: pieces.map((p) => p.raw).join(""), tags };
}

function restore(segment: Segment, translated: string | undefined): string {
	// Any lost, duplicated or invented placeholder means the markup would
	// break: keep the original text for this span instead.
	if (!translated || placeholdersOf(translated) !== placeholdersOf(segment.text)) {
		return segment.original;
	}
	return translated.replace(PLACEHOLDER_RE, (placeholder) => segment.tags.get(placeholder) ?? "");
}

// Build segments from runs of inline pieces. Whitespace, filler and tags
// wrapping a run stay outside its segment, so the model sees only text.
function segmentPieces(pieces: Piece[]): Segmented {
	const out: (string | number)[] = [];
	const segments: Segment[] = [];

	let run: Piece[] = [];
	const isBlank = (p: Piece) => !p.text || EDGE_RE.exec(p.raw)?.[2] === "";
	const flush = () => {
		if (run.length === 0) return;
		const hasText = run.some((p) => p.text && HAS_LETTER.test(p.raw.replace(/&[#\w]+;/g, "")));
		if (!hasText) {
			out.push(run.map((p) => p.raw).join(""));
			run = [];
			return;
		}
		let start = 0;
		let end = run.length;
		while (start < end && isBlank(run[start])) start++;
		while (end > start && isBlank(run[end - 1])) end--;

		const body = run.slice(start, end).map((p) => ({ ...p }));
		// Peel filler off the first/last text pieces (always text: blanks were trimmed).
		const first = body[0];
		const last = body[body.length - 1];
		const lead = EDGE_RE.exec(first.raw)?.[1] ?? "";
		first.raw = first.raw.slice(lead.length);
		const trail = EDGE_RE.exec(last.raw)?.[3] ?? "";
		last.raw = last.raw.slice(0, last.raw.length - trail.length);

		const join = (list: Piece[]) => list.map((p) => p.raw).join("");
		out.push(join(run.slice(0, start)) + lead);
		out.push(segments.length);
		segments.push(toSegment(body));
		out.push(trail + join(run.slice(end)));
		run = [];
	};

	for (const piece of pieces) {
		if (piece.inline) {
			run.push(piece);
		} else {
			flush();
			out.push(piece.raw);
		}
	}
	flush();

	return {
		segments: segments.map((segment) => segment.text),
		rebuild(translated) {
			return out
				.map((part) =>
					typeof part === "number" ? restore(segments[part], translated[part]) : part,
				)
				.join("");
		},
	};
}

export function segmentHTML(html: string): Segmented {
	return segmentPieces(tokenize(html));
}

// Plain text: paragraphs separated by blank lines, separators kept verbatim.
export function segmentText(text: string): Segmented {
	const parts = text.split(/(\n[ \t]*\n\s*)/);
	const pieces: Piece[] = parts.map((raw, i) =>
		i % 2 === 1 ? { raw, inline: false, text: false } : { raw, inline: true, text: true },
	);
	return segmentPieces(pieces);
}
