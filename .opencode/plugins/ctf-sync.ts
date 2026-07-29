import { tool, type Plugin } from "@opencode-ai/plugin";
import { readFile, writeFile, unlink } from "node:fs/promises";
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

async function readStateFile(projectDir: string): Promise<Record<string, string> | null> {
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

async function callWorker(workerUrl: string, path: string, body: Record<string, unknown>) {
	const res = await fetch(`${workerUrl}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as { ok: boolean; error?: string; data?: unknown };
	if (!json.ok) {
		throw new Error(json.error || "Worker request failed");
	}
	return json.data;
}

async function fetchChallenges(workerUrl: string): Promise<string[]> {
	const res = await fetch(`${workerUrl}/challenges`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
	const json = (await res.json()) as { ok: boolean; error?: string; data?: unknown };
	if (!json.ok || !Array.isArray(json.data)) return [];
	return json.data as string[];
}

function fuzzyMatchChallenge(input: string, challenges: string[]): string | null {
	const lower = input.toLowerCase().trim();

	const exact = challenges.find((c) => c.toLowerCase() === lower);
	if (exact) return exact;

	const contains = challenges.filter((c) => c.toLowerCase().includes(lower));
	if (contains.length === 1) return contains[0];

	return null;
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
			if (!state?.threadId) return;

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

			await syncMessage(workerUrl, state.threadId, ctfUser, textParts);
			} catch {}
		},

		tool: {
			ctf_admin_init: tool({
				description:
					"Initialize the CTF challenge list. Creates Players and Challenges boards in Discord. Admin only. The LLM should extract challenge names from the user's message text and pass them as an array.",
				args: {
					challenges: tool.schema.array(tool.schema.string()).describe("List of challenge names extracted from the user's message"),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const adminSecret = env.ADMIN_SECRET;
					if (!workerUrl) return "WORKER_URL not set in .env. Ask the user to configure it.";
					if (!adminSecret) return "ADMIN_SECRET not set in .env. Ask the user to configure it.";

					try {
						const result = (await callWorker(workerUrl, "/adminInit", {
							secret: adminSecret,
							challenges: args.challenges,
						})) as { warning?: string };

						if (result?.warning) return result.warning;
						return `CTF initialized with ${args.challenges.length} challenges. Players and Challenges boards posted to Discord.`;
					} catch (e) {
						return `AdminInit failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_admin_reset: tool({
				description:
					"Reset the CTF state to defaults. Admin only. Use this to clear everything and re-initialize from scratch.",
				args: {},
				async execute() {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const adminSecret = env.ADMIN_SECRET;
					if (!workerUrl) return "WORKER_URL not set in .env.";
					if (!adminSecret) return "ADMIN_SECRET not set in .env.";

					try {
						await callWorker(workerUrl, "/adminReset", { secret: adminSecret });

						try {
							await unlink(join(projectDir, ".ctf-state.json"));
						} catch {}

						return "CTF state reset. Run ctf_admin_init to reinitialize.";
					} catch (e) {
						return `AdminReset failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_init: tool({
				description:
					"Register your Discord display name with the CTF team. Call this once when first joining the CTF.",
				args: {
					name: tool.schema.string().describe("Your Discord display name"),
					userId: tool.schema.string().optional().describe("Your Discord user ID for clickable mentions"),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					if (!workerUrl) return "WORKER_URL not set in .env. Ask the user to configure it.";

					try {
						const result = (await callWorker(workerUrl, "/init", { user: args.name, userId: args.userId })) as {
							displayName: string;
							wasNew: boolean;
						};
						if (result.wasNew) {
							return `Registered as ${result.displayName}. You're now on the CTF team board in Discord! Add CTF_USER=${result.displayName} to your .env file.`;
						}
						return `Already registered as ${result.displayName}. You're on the team board.`;
					} catch (e) {
						return `Init failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_start: tool({
				description:
					"Start working on a CTF challenge. Creates a Discord channel (if new) and a personal thread for syncing your solving work.",
				args: {
					challenge: tool.schema.string().describe("The challenge name"),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const ctfUser = env.CTF_USER;
					if (!workerUrl) return "WORKER_URL not set in .env. Ask the user to configure it.";
					if (!ctfUser) return "CTF_USER not set. Run ctf_init first.";

					let challengeName = String(args.challenge).trim();
					const sessionID = `opencode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

					try {
						const result = (await callWorker(workerUrl, "/start", {
							user: ctfUser,
							challenge: challengeName,
							sessionId: sessionID,
						})) as { channelId: string; threadId: string; challengeName: string };

						await writeFile(
							join(projectDir, ".ctf-state.json"),
							JSON.stringify(
								{
									challengeName: result.challengeName,
									channelId: result.channelId,
									threadId: result.threadId,
									sessionId: sessionID,
								},
								null,
								2,
							),
						);

						return `Started ${result.challengeName}. New Discord thread created. Your solving work will now sync to Discord automatically.`;
					} catch (firstErr) {
						const challenges = await fetchChallenges(workerUrl);
						if (challenges.length === 0) {
							return `Start failed: ${(firstErr as Error).message}`;
						}

						const match = fuzzyMatchChallenge(challengeName, challenges);
						if (match) {
							challengeName = match;
						} else {
							const suggestions = challenges
								.filter((c) => c.toLowerCase().includes(challengeName.toLowerCase()))
								.slice(0, 5);
							if (suggestions.length > 1) {
								return `Challenge "${challengeName}" not found. Did you mean one of:\n- ${suggestions.join("\n- ")}`;
							}
							return `Challenge "${challengeName}" not found. Available: ${challenges.join(", ")}`;
						}

						try {
							const result = (await callWorker(workerUrl, "/start", {
								user: ctfUser,
								challenge: challengeName,
								sessionId: sessionID,
							})) as { channelId: string; threadId: string; challengeName: string };

							await writeFile(
								join(projectDir, ".ctf-state.json"),
								JSON.stringify(
									{
										challengeName: result.challengeName,
										channelId: result.channelId,
										threadId: result.threadId,
										sessionId: sessionID,
									},
									null,
									2,
								),
							);

							return `Started ${result.challengeName}. New Discord thread created. Your solving work will now sync to Discord automatically.`;
						} catch (secondErr) {
							return `Start failed: ${(secondErr as Error).message}`;
						}
					}
				},
			}),

			ctf_finish: tool({
				description:
					"Finish the current CTF challenge. Moves the channel to finished if no other teammates are still working. Requires confirmation.",
				args: {
					confirm: tool.schema
						.boolean()
						.optional()
						.describe("Set to true to confirm after reviewing the challenge name."),
					challengeName: tool.schema
						.string()
						.optional()
						.describe("Challenge name if you lost track of which challenge you're working on."),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const ctfUser = env.CTF_USER;
					if (!workerUrl) return "WORKER_URL not set in .env.";
					if (!ctfUser) return "CTF_USER not set. Run ctf_init first.";

					const state = await readStateFile(projectDir);
					const challengeName = args.challengeName || state?.challengeName;
					let channelId = state?.channelId;

					if (!challengeName) {
						return "Could not determine challenge name. Please provide it: ctf_finish({ challengeName: 'name' })";
					}

					if (!channelId) {
						try {
							const lookup = (await callWorker(workerUrl, "/lookup", {
								challengeName,
							})) as { channelId: string };
							channelId = lookup.channelId;
						} catch {
							return `Could not find channel for "${challengeName}". Has /start been run?`;
						}
					}

					if (!args.confirm) {
						return `Are you sure you found the correct flag for "${challengeName}"? Call ctf_finish again with confirm: true.`;
					}

					try {
						const result = (await callWorker(workerUrl, "/finish", {
							user: ctfUser,
							channelId,
						})) as {
							moved: boolean;
							challengeName: string;
							solverName?: string;
							remainingActiveUsers?: number;
						};

						try {
							await unlink(join(projectDir, ".ctf-state.json"));
						} catch {}

						if (result.moved) {
							return `${result.challengeName} solved by ${result.solverName}! Challenge moved to finished.`;
						}
						return `Noted. ${result.remainingActiveUsers} other teammate(s) still working on ${result.challengeName}. Channel stays.`;
					} catch (e) {
						return `Finish failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_helpme: tool({
				description:
					"Request help on the current challenge. Moves the challenge channel to help-me. This is a shared claim. Requires confirmation.",
				args: {
					confirm: tool.schema
						.boolean()
						.optional()
						.describe("Set to true to confirm after double-checking the challenge name."),
					challengeName: tool.schema.string().optional().describe("Override challenge name if needed."),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const ctfUser = env.CTF_USER;
					if (!workerUrl) return "WORKER_URL not set in .env.";
					if (!ctfUser) return "CTF_USER not set. Run ctf_init first.";

					const state = await readStateFile(projectDir);
					const challengeName = args.challengeName || state?.challengeName;
					let channelId = state?.channelId;

					if (!challengeName) {
						return "Could not determine challenge name. Provide it: ctf_helpme({ challengeName: 'name' })";
					}

					if (!channelId) {
						try {
							const lookup = (await callWorker(workerUrl, "/lookup", {
								challengeName,
							})) as { channelId: string };
							channelId = lookup.channelId;
						} catch {
							return `Could not find channel for "${challengeName}". Has /start been run?`;
						}
					}

					if (!args.confirm) {
						return `Move "${challengeName}" to help-me? This is a shared claim — everyone in the channel sees it. Call ctf_helpme again with confirm: true.`;
					}

					try {
						const result = (await callWorker(workerUrl, "/helpme", {
							user: ctfUser,
							channelId,
						})) as { moved: boolean; challengeName: string };

						if (result.moved) {
							return `${result.challengeName} moved to help-me. Teammates can now see the help request.`;
						}
						return `${result.challengeName} is already in help-me.`;
					} catch (e) {
						return `Helpme failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_undoFinish: tool({
				description: "Undo a finished challenge. Moves it back to active challenges.",
				args: {
					challengeName: tool.schema.string().describe("The challenge name to undo"),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					if (!workerUrl) return "WORKER_URL not set in .env.";

					try {
						const result = (await callWorker(workerUrl, "/undoFinish", {
							challengeName: args.challengeName,
						})) as { challengeName: string; restoredTo: string };

						return `Undid finish for ${result.challengeName}. Moved back to ${result.restoredTo}.`;
					} catch (e) {
						return `Undo failed: ${(e as Error).message}`;
					}
				},
			}),

			ctf_undoStart: tool({
				description:
					"Undo a started challenge. Removes you from the active users and clears your session. Use when you want to abandon a challenge you started.",
				args: {
					challengeName: tool.schema.string().optional().describe("Challenge name. Defaults to the current session challenge."),
				},
				async execute(args) {
					const env = await readEnv(projectDir);
					const workerUrl = env.WORKER_URL;
					const ctfUser = env.CTF_USER;
					if (!workerUrl) return "WORKER_URL not set in .env.";
					if (!ctfUser) return "CTF_USER not set. Run ctf_init first.";

					const state = await readStateFile(projectDir);
					const challengeName = args.challengeName || state?.challengeName;

					if (!challengeName) {
						return "Could not determine challenge name. Provide it: ctf_undoStart({ challengeName: 'name' })";
					}

					try {
						const result = (await callWorker(workerUrl, "/undoStart", {
							user: ctfUser,
							challengeName,
						})) as { challengeName: string; user: string };

						try {
							await unlink(join(projectDir, ".ctf-state.json"));
						} catch {}

						return `Undid start for ${result.challengeName}. You are no longer working on it.`;
					} catch (e) {
						return `UndoStart failed: ${(e as Error).message}`;
					}
				},
			}),
		},
	};
};

export default CTFSyncPlugin;
