import { Button, Spinner } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, type ClientCtx } from "@/api/client";
import {
	ArrowLeftIcon,
	DownloadIcon,
	PaperclipIcon,
	ReplyIcon,
	TrashIcon,
} from "@/components/Icons";
import { formatBytes, formatDateLong, initials, senderLabel } from "@/lib/format";
import type { AttachmentSummary, Email } from "@/types";

interface Props {
	ctx: ClientCtx;
	emailId: string;
	onBack: () => void;
	onDeleted: () => void;
	onReply: (email: Email) => void;
}

export function EmailDetail({ ctx, emailId, onBack, onDeleted, onReply }: Props) {
	const [email, setEmail] = useState<Email | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		api
			.get(ctx, emailId)
			.then((e) => {
				if (!cancelled) setEmail(e);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
				setError(msg);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [ctx, emailId]);

	async function handleDelete() {
		if (!email) return;
		if (!window.confirm("Delete this email? This cannot be undone.")) return;
		setDeleting(true);
		try {
			await api.delete(ctx, email.id);
			onDeleted();
		} catch (err) {
			const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : String(err);
			setError(msg);
		} finally {
			setDeleting(false);
		}
	}

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center">
				<Spinner />
			</div>
		);
	}
	if (error || !email) {
		return (
			<div className="p-6">
				<Button variant="ghost" onPress={onBack}>
					<ArrowLeftIcon /> Back
				</Button>
				<div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{error ?? "Email not found"}
				</div>
			</div>
		);
	}

	const subject = email.subject?.trim() || "(no subject)";

	return (
		<div className="flex h-full flex-col bg-white">
			<div className="flex items-center justify-between gap-2 border-b border-black/5 px-4 py-3">
				<Button variant="ghost" size="sm" onPress={onBack}>
					<ArrowLeftIcon /> Inbox
				</Button>
				<div className="flex gap-1">
					<Button variant="ghost" size="sm" onPress={() => onReply(email)}>
						<ReplyIcon /> Reply
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onPress={handleDelete}
						isPending={deleting}
					>
						<TrashIcon /> Delete
					</Button>
				</div>
			</div>

			<div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
				<div className="border-b border-black/5 px-6 py-5">
					<h1 className="break-words text-xl font-semibold text-black/90">{subject}</h1>
					<div className="mt-3 flex items-start gap-3">
						<div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
							{initials(email.from_address)}
						</div>
						<div className="min-w-0 flex-1 text-sm">
							<div className="flex flex-wrap items-baseline justify-between gap-2">
								<div className="font-medium text-black/90">
									{senderLabel(email.from_address)}{" "}
									<span className="font-normal text-black/50">
										&lt;{email.from_address}&gt;
									</span>
								</div>
								<div className="text-xs text-black/50">
									{formatDateLong(email.received_at)}
								</div>
							</div>
							<div className="text-black/55">to {email.to_address}</div>
						</div>
					</div>
				</div>

				{email.attachments && email.attachments.length > 0 ? (
					<AttachmentList ctx={ctx} emailId={email.id} attachments={email.attachments} />
				) : null}

				<EmailBody html={email.html_content} text={email.text_content} />
			</div>
		</div>
	);
}

function EmailBody({ html, text }: { html: string | null; text: string | null }) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [height, setHeight] = useState(0);

	useEffect(() => {
		if (!html || !iframeRef.current) return;
		const iframe = iframeRef.current;
		// Keep email's native table layout intact; only constrain images and the body
		// so horizontal scroll never appears. Long unbreakable strings wrap.
		const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
			html,body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;background:#fff;font-size:14px;line-height:1.55}
			html{overflow-x:hidden}
			body{padding:16px 24px;overflow-x:hidden;word-wrap:break-word;overflow-wrap:break-word}
			img,video{max-width:100%;height:auto}
			a{color:#1a73e8;word-break:break-all}
			blockquote{margin:8px 0;padding:4px 0 4px 12px;border-left:3px solid #dadce0;color:#5f6368}
			pre,code{white-space:pre-wrap;word-break:break-word}
		</style></head><body>${html}</body></html>`;
		iframe.srcdoc = doc;

		let observer: ResizeObserver | null = null;
		let cancelled = false;
		const timers: number[] = [];

		const measure = () => {
			if (cancelled) return;
			const cdoc = iframe.contentDocument;
			const body = cdoc?.body;
			const root = cdoc?.documentElement;
			if (!body || !root) return;
			const h = Math.max(body.scrollHeight, body.offsetHeight, root.scrollHeight);
			if (h > 0) setHeight((prev) => (h !== prev ? h : prev));
		};

		const onLoad = () => {
			// Measure across a few frames to catch stylesheet / font / image layout.
			requestAnimationFrame(measure);
			timers.push(window.setTimeout(measure, 50));
			timers.push(window.setTimeout(measure, 250));
			timers.push(window.setTimeout(measure, 1000));

			const cdoc = iframe.contentDocument;
			const body = cdoc?.body;
			if (body && "ResizeObserver" in window) {
				observer = new ResizeObserver(measure);
				observer.observe(body);
			}
			const imgs = cdoc?.images;
			if (imgs) {
				for (const img of Array.from(imgs)) {
					if (!img.complete) {
						img.addEventListener("load", measure, { once: true });
						img.addEventListener("error", measure, { once: true });
					}
				}
			}
			// Web fonts loading later can shift layout too.
			cdoc?.fonts?.ready?.then(measure).catch(() => {});
		};

		iframe.addEventListener("load", onLoad);
		return () => {
			cancelled = true;
			iframe.removeEventListener("load", onLoad);
			observer?.disconnect();
			for (const t of timers) window.clearTimeout(t);
		};
	}, [html]);

	if (html) {
		return (
			<iframe
				ref={iframeRef}
				title="Email content"
				className="email-html-frame block"
				sandbox="allow-popups allow-popups-to-escape-sandbox"
				style={{ height: height || 400, width: "100%" }}
			/>
		);
	}
	if (text) {
		return (
			<pre className="whitespace-pre-wrap break-words px-6 py-5 font-sans text-sm leading-relaxed text-black/85">
				{text}
			</pre>
		);
	}
	return <div className="px-6 py-5 text-sm text-black/50">(empty message)</div>;
}

function AttachmentList({
	ctx,
	emailId,
	attachments,
}: {
	ctx: ClientCtx;
	emailId: string;
	attachments: AttachmentSummary[];
}) {
	const [downloading, setDownloading] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);

	async function download(att: AttachmentSummary) {
		setDownloading(att.id);
		setErr(null);
		try {
			await api.downloadAttachment(ctx, emailId, att.id, att.filename || att.id);
		} catch (e) {
			const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : String(e);
			setErr(msg);
		} finally {
			setDownloading(null);
		}
	}

	return (
		<div className="border-b border-black/5 px-6 py-4">
			<div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/55">
				<PaperclipIcon width={14} height={14} />
				{attachments.length} attachment{attachments.length === 1 ? "" : "s"}
			</div>
			<div className="flex flex-wrap gap-2">
				{attachments.map((att) => (
					<button
						key={att.id}
						type="button"
						onClick={() => download(att)}
						disabled={downloading === att.id}
						className="group flex max-w-xs items-center gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-60"
					>
						<div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-black/5 text-black/60">
							<DownloadIcon width={16} height={16} />
						</div>
						<div className="min-w-0">
							<div className="truncate text-sm font-medium text-black/85">
								{att.filename || att.id}
							</div>
							<div className="text-xs text-black/50">
								{formatBytes(att.size)}
								{att.mime_type ? ` · ${att.mime_type}` : ""}
							</div>
						</div>
					</button>
				))}
			</div>
			{err ? <div className="mt-2 text-xs text-red-600">{err}</div> : null}
		</div>
	);
}
