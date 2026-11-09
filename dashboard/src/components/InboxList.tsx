import { Button, Spinner } from "@heroui/react";
import { PaperclipIcon } from "@/components/Icons";
import { formatDate, initials, senderLabel } from "@/lib/format";
import type { EmailSummary, PaginatedEmails } from "@/types";

interface Props {
	data: PaginatedEmails | null;
	loading: boolean;
	error: string | null;
	selectedId: string | null;
	onSelect: (email: EmailSummary) => void;
	onPage: (offset: number) => void;
}

export function InboxList({ data, loading, error, selectedId, onSelect, onPage }: Props) {
	const emails = data?.emails ?? [];
	const limit = data?.limit ?? 50;
	const offset = data?.offset ?? 0;
	const total = data?.total ?? 0;

	return (
		<div className="flex h-full flex-col bg-white">
			{error ? (
				<div className="m-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
					{error}
				</div>
			) : null}

			<div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
				{loading && emails.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : emails.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center text-sm text-black/50">
						<div>No emails yet.</div>
					</div>
				) : (
					<ul className="divide-y divide-black/5">
						{emails.map((email) => (
							<li key={email.id}>
								<button
									type="button"
									onClick={() => onSelect(email)}
									className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-blue-50/60 ${
										selectedId === email.id ? "bg-blue-50" : ""
									}`}
								>
									<div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
										{initials(email.from_address)}
									</div>
									<div className="min-w-0 flex-1">
										<div className="flex items-baseline justify-between gap-2">
											<div className="flex min-w-0 items-center gap-1.5">
												{email.has_attachments ? (
													<PaperclipIcon
														width={13}
														height={13}
														className="flex-none text-black/40"
													/>
												) : null}
												<div className="truncate text-sm font-semibold text-black/90">
													{email.subject?.trim() || "(no subject)"}
												</div>
											</div>
											<div className="flex-none text-xs text-black/50">
												{formatDate(email.received_at)}
											</div>
										</div>
										<div className="truncate text-sm text-black/65">
											{senderLabel(email.from_address)}
										</div>
										<div className="truncate text-xs text-black/45">
											to {email.to_address}
										</div>
									</div>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			{total > limit ? (
				<div className="flex items-center justify-between border-t border-black/5 px-4 py-2 text-xs text-black/60">
					<span>
						{offset + 1}–{Math.min(offset + emails.length, total)} of {total}
					</span>
					<div className="flex gap-1">
						<Button
							size="sm"
							variant="ghost"
							isDisabled={offset === 0}
							onPress={() => onPage(Math.max(0, offset - limit))}
						>
							Prev
						</Button>
						<Button
							size="sm"
							variant="ghost"
							isDisabled={offset + emails.length >= total}
							onPress={() => onPage(offset + limit)}
						>
							Next
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
