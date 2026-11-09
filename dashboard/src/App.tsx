import { Button } from "@heroui/react";
import { useCallback, useMemo, useState } from "react";
import type { ClientCtx } from "@/api/client";
import {
	GearIcon,
	MailIcon,
	PencilIcon,
	RefreshIcon,
} from "@/components/Icons";
import { ComposeModal, type ComposeDraft } from "@/components/ComposeModal";
import { EmailDetail } from "@/components/EmailDetail";
import { FiltersBar } from "@/components/FiltersBar";
import { InboxList } from "@/components/InboxList";
import { SettingsModal } from "@/components/SettingsModal";
import { SetupScreen } from "@/components/SetupScreen";
import { useEmails } from "@/hooks/useEmails";
import {
	type DashboardConfig,
	isConfigured,
	loadConfig,
	saveConfig,
} from "@/lib/config";
import { formatDate } from "@/lib/format";
import type { Email, EmailFilters } from "@/types";

const DEFAULT_FILTERS: EmailFilters = { limit: 50, offset: 0 };

export default function App() {
	const [config, setConfig] = useState<DashboardConfig>(() => loadConfig());
	const [filters, setFilters] = useState<EmailFilters>(DEFAULT_FILTERS);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);

	const ctx: ClientCtx = useMemo(
		() => ({ host: config.host, token: config.apiToken }),
		[config.host, config.apiToken],
	);

	const onNewEmail = useCallback(() => {
		// Currently no per-email action; bump key if a select callback was needed.
		setRefreshKey((k) => k + 1);
	}, []);

	const { data, loading, error, lastFetched, refresh } = useEmails(
		ctx,
		config,
		filters,
		onNewEmail,
	);

	if (!isConfigured(config)) {
		return (
			<SetupScreen
				initial={config}
				onSave={(cfg) => {
					saveConfig(cfg);
					setConfig(cfg);
				}}
			/>
		);
	}

	function persist(cfg: DashboardConfig) {
		saveConfig(cfg);
		setConfig(cfg);
	}

	function handleReply(email: Email) {
		setComposeDraft({
			to: email.from_address,
			subject: email.subject?.startsWith("Re:") ? email.subject : `Re: ${email.subject ?? ""}`,
			body: `\n\n--- On ${new Date(email.received_at).toLocaleString()}, ${email.from_address} wrote ---\n${
				email.text_content ?? ""
			}`,
			from: config.defaultFrom || email.to_address,
		});
	}

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fa]">
			<header className="flex items-center gap-3 border-b border-black/5 bg-white px-4 py-2.5">
				<div className="flex items-center gap-2">
					<img src="/logo.svg" alt="MailClaw" className="h-8 w-8" />
					<div className="text-lg font-semibold tracking-tight text-black/85">
						MailClaw
					</div>
				</div>
				<div className="ml-2 hidden text-xs text-black/50 sm:block">
					{lastFetched ? `Updated ${formatDate(lastFetched)}` : "—"}
					{config.refreshSeconds > 0 ? ` · auto-refresh ${config.refreshSeconds}s` : ""}
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						onPress={() => void refresh()}
						isPending={loading}
					>
						<RefreshIcon /> Refresh
					</Button>
					<Button
						size="sm"
						onPress={() =>
							setComposeDraft({
								to: "",
								subject: "",
								body: "",
								from: config.defaultFrom,
							})
						}
					>
						<PencilIcon /> Compose
					</Button>
					<Button
						size="sm"
						variant="ghost"
						isIconOnly
						onPress={() => setSettingsOpen(true)}
						aria-label="Settings"
					>
						<GearIcon />
					</Button>
				</div>
			</header>

			<div className="flex min-h-0 flex-1 overflow-hidden">
				<aside className="flex w-[380px] min-w-[320px] flex-col overflow-hidden border-r border-black/5">
					<FiltersBar value={filters} onChange={setFilters} />
					<InboxList
						key={refreshKey}
						data={data}
						loading={loading}
						error={error}
						selectedId={selectedId}
						onSelect={(e) => setSelectedId(e.id)}
						onPage={(offset) => setFilters((f) => ({ ...f, offset }))}
					/>
				</aside>

				<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
					{selectedId ? (
						<EmailDetail
							ctx={ctx}
							emailId={selectedId}
							onBack={() => setSelectedId(null)}
							onDeleted={() => {
								setSelectedId(null);
								void refresh();
							}}
							onReply={handleReply}
						/>
					) : (
						<EmptyState />
					)}
				</main>
			</div>

			<ComposeModal
				ctx={ctx}
				defaultFrom={config.defaultFrom}
				draft={composeDraft}
				onClose={(sent) => {
					setComposeDraft(null);
					if (sent) void refresh();
				}}
			/>

			<SettingsModal
				isOpen={settingsOpen}
				config={config}
				onClose={() => setSettingsOpen(false)}
				onSave={persist}
				onSignOut={() => {
					setConfig(loadConfig());
					setSettingsOpen(false);
				}}
			/>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 text-black/40">
			<MailIcon width={56} height={56} />
			<div className="text-sm">Select an email to read</div>
		</div>
	);
}
