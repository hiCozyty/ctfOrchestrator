import { type Plugin } from "@opencode-ai/plugin";
import { readFile, writeFile } from "node:fs/promises";
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

async function readSessionMap(projectDir: string): Promise<Record<string, string>> {
	try {
		const raw = await readFile(join(projectDir, ".ctf-session-map.json"), "utf-8");
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

async function writeSessionMap(projectDir: string, map: Record<string, string>): Promise<void> {
	try {
		await writeFile(join(projectDir, ".ctf-session-map.json"), JSON.stringify(map, null, 2));
	} catch {}
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

function parseSessionDataToken(part: Record<string, unknown>): string | null {
	const text = typeof part.text === "string" ? part.text
		: typeof part.content === "string" ? part.content
		: null;
	if (!text) return null;
	const match = text.match(/CTF_SESSION_DATA:\s*(\{[^}]+\})/);
	if (!match) return null;
	try {
		const data = JSON.parse(match[1]);
		return data.threadId || null;
	} catch {
		return null;
	}
}

export const CTFSyncPlugin: Plugin = async ({ client, directory }) => {
	const projectDir = directory;
	let sessionMap: Record<string, string> = {};

	return {
		event: async ({ event }) => {
			if (event.type !== "session.idle") return;
			const sessionID = event.properties?.sessionID;
			if (!sessionID) return;

			const env = await readEnv(projectDir);
			const workerUrl = env.WORKER_URL;
			const ctfUser = env.CTF_USER;
			if (!workerUrl || !ctfUser) return;

			let threadId: string | undefined;

			if (sessionMap[sessionID]) {
				threadId = sessionMap[sessionID];
			} else {
				const persistedMap = await readSessionMap(projectDir);
				if (persistedMap[sessionID]) {
					sessionMap[sessionID] = persistedMap[sessionID];
					threadId = persistedMap[sessionID];
				}
			}

			if (!threadId) {
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
					if (messages && Array.isArray(messages)) {
						for (let i = messages.length - 1; i >= 0; i--) {
							const msg = messages[i];
							const parts = msg.parts || [];
							for (const part of parts) {
								const tokenThreadId = parseSessionDataToken(part as Record<string, unknown>);
								if (tokenThreadId) {
									sessionMap[sessionID] = tokenThreadId;
									await writeSessionMap(projectDir, sessionMap);
									threadId = tokenThreadId;
									break;
								}
							}
							if (threadId) break;
						}
					}
				} catch {}
			}

			if (!threadId) {
				const state = await readStateFile(projectDir);
				if (state) {
					const current = state.current as string | undefined;
					const active = state.active as Record<string, { threadId?: string }> | undefined;
					threadId = current ? active?.[current]?.threadId : undefined;
					if (threadId) {
						sessionMap[sessionID] = threadId;
						await writeSessionMap(projectDir, sessionMap);
					}
				}
			}

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
