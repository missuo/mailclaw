import { deleteDevice, getDevices } from "@/database/d1";
import { base64ToUint8Array } from "@/utils/helpers";

const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";
// Apple accepts provider tokens for up to 60 minutes; refresh well before that.
const JWT_TTL_SECONDS = 45 * 60;

interface ApnsConfig {
	privateKey: string;
	keyId: string;
	teamId: string;
	topic: string;
}

export function getApnsConfig(env: CloudflareBindings): ApnsConfig | null {
	if (!env.APNS_KEY || !env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_TOPIC) {
		return null;
	}
	return {
		privateKey: env.APNS_KEY,
		keyId: env.APNS_KEY_ID,
		teamId: env.APNS_TEAM_ID,
		topic: env.APNS_TOPIC,
	};
}

function base64UrlEncode(data: Uint8Array | string): string {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Module-level cache: Workers isolates live across requests, so the signed
// JWT is reused until it nears Apple's 60-minute limit.
let cachedJwt: { token: string; issuedAt: number; keyId: string } | null = null;

async function getProviderToken(config: ApnsConfig): Promise<string> {
	const nowSeconds = Math.floor(Date.now() / 1000);
	if (
		cachedJwt &&
		cachedJwt.keyId === config.keyId &&
		nowSeconds - cachedJwt.issuedAt < JWT_TTL_SECONDS
	) {
		return cachedJwt.token;
	}

	const pem = config.privateKey
		.replace(/-----BEGIN PRIVATE KEY-----/, "")
		.replace(/-----END PRIVATE KEY-----/, "")
		.replace(/\s+/g, "");
	const keyData = base64ToUint8Array(pem);

	const key = await crypto.subtle.importKey(
		"pkcs8",
		keyData.slice().buffer,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);

	const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: config.keyId }));
	const payload = base64UrlEncode(JSON.stringify({ iss: config.teamId, iat: nowSeconds }));
	const signingInput = `${header}.${payload}`;

	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(signingInput),
	);

	const token = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
	cachedJwt = { token, issuedAt: nowSeconds, keyId: config.keyId };
	return token;
}

export interface PushableEmail {
	id: string;
	from_address: string;
	to_address: string;
	subject: string | null;
}

// Pushes a new-mail alert to every registered device. No-op unless the
// APNS_* secrets are configured. Never throws — push failures must not
// affect email ingestion.
export async function pushNewEmail(env: CloudflareBindings, email: PushableEmail): Promise<void> {
	const config = getApnsConfig(env);
	if (!config) return;

	try {
		const { devices, error } = await getDevices(env.D1);
		if (error || devices.length === 0) return;

		const providerToken = await getProviderToken(config);
		const body = JSON.stringify({
			aps: {
				alert: {
					title: email.from_address,
					body: email.subject || "(no subject)",
				},
				sound: "default",
				"mutable-content": 1,
				"thread-id": email.from_address,
			},
			email_id: email.id,
			from: email.from_address,
			to: email.to_address,
			subject: email.subject,
		});

		await Promise.allSettled(
			devices.map(async (device) => {
				const host = device.environment === "sandbox" ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;
				const response = await fetch(`${host}/3/device/${device.token}`, {
					method: "POST",
					headers: {
						authorization: `bearer ${providerToken}`,
						"apns-topic": config.topic,
						"apns-push-type": "alert",
						"apns-priority": "10",
						"apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
						"content-type": "application/json",
					},
					body,
				});

				if (response.ok) return;

				const detail = (await response.json().catch(() => null)) as { reason?: string } | null;
				const reason = detail?.reason ?? "";
				if (response.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") {
					await deleteDevice(env.D1, device.token);
					console.log(`Removed stale device token (${reason || response.status})`);
				} else {
					console.error(`APNs push failed: ${response.status} ${reason}`);
				}
			}),
		);
	} catch (err) {
		console.error("APNs push error:", err);
	}
}
