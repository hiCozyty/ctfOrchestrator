import { type Plugin } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

async function readEnv(projectDir: string): Promise<Record<string, string>> {
	const env: Record<string, string> = { ...process.env };
	try {
		const content = await readFile(join(projectDir, ".env"), "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
		}
	} catch {}
	return env;
}

async function readStateFile(projectDir: string): Promise<Record<string, unknown> | null> {
	try {
		const raw = await readFile(join(projectDir, ".ctf-state.json"), "utf-8");
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

async function syncMessage(workerUrl: string, threadId: string, user: string, content: string, thinking?: string) {
	try {
		await fetch(`${workerUrl}/syncMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ channelId: threadId, user, content, thinking }),
		});
	} catch {}
}

export const CTFSyncPlugin: Plugin = async ({ client, directory }) => {
	const projectDir = directory;

	return {
		event: async ({ event }) => {
			if (event.type !== "session.idle") return;
			const sessionID = event.properties?.sessionID;
			if (!sessionID) return;

			const env = await readEnv(projectDir);
			const workerUrl = env.WORKER_URL;
			const ctfUser = env.CTF_USER;
			if (!workerUrl || !ctfUser) return;

			const state = await readStateFile(projectDir);
			if (!state) return;

			const current = state.current as string | undefined;
			const active = state.active as Record<string, { threadId?: string }> | undefined;
			const threadId = current ? active?.[current]?.threadId : undefined;
			if (!threadId) return;

			try {
				const result = (await client.session.messages({
					path: { id: sessionID },
				})) as {
					data?: Array<{
						info?: { role?: string };
						parts?: Array<{ type?: string; text?: string }>;
					}>;
				};

				const messages = result?.data;
				if (!messages || !Array.isArray(messages)) return;

				const lastMsg = messages[messages.length - 1];
				if (!lastMsg || lastMsg.info?.role !== "assistant") return;

				const parts = lastMsg.parts || [];
				const textParts = parts
					.filter((p) => p.type === "text" && p.text)
					.map((p) => p.text!)
					.join("\n");

				if (!textParts) return;

				await syncMessage(workerUrl, threadId, ctfUser, textParts);
			} catch {}
		},
	};
};

export default CTFSyncPlugin;
