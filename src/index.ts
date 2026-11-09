import app from "@/app";
import { purgeDeletedEmails } from "@/database/d1";
import { handleEmail } from "@/handlers/email";

// Trash retention: soft-deleted emails are purged after 30 days.
const TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60;

async function handleScheduled(
	_controller: ScheduledController,
	env: CloudflareBindings,
	_ctx: ExecutionContext,
) {
	const cutoff = Math.floor(Date.now() / 1000) - TRASH_RETENTION_SECONDS;
	const { purged, r2Keys, error } = await purgeDeletedEmails(env.D1, cutoff);

	if (error) {
		console.error("Trash purge failed:", error);
		return;
	}
	if (r2Keys.length > 0) {
		await env.ATTACHMENTS.delete(r2Keys);
	}
	if (purged > 0) {
		console.log(`Trash purge: removed ${purged} email(s), ${r2Keys.length} attachment(s)`);
	}
}

export default {
	fetch: app.fetch,
	email: handleEmail,
	scheduled: handleScheduled,
};
