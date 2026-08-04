import { DurableObject } from "cloudflare:workers";

const DISCORD_API = "https://discord.com/api/v10";

const GUILD_ID = "1530685499646279931";
const CTF_CHALLENGES_CATEGORY = "1530688113708634287";
const HELP_ME_CATEGORY = "1530744344221585508";
const FINISHED_CHALLENGES_CATEGORY = "1530748539301400586";
const OFFLINE_CHALLENGES_CATEGORY = "1533649005928517792";
const PROGRESS_CHANNEL = "1530742679326035978";

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
		},
	});
}

function err(message, status = 400) {
	return json({ ok: false, error: message }, status);
}

function normalizeName(s) {
	return s.normalize("NFKC").trim();
}

function sanitizeName(s) {
	return s.replace(/[^a-zA-Z0-9\s\-]/g, "").trim();
}

function defaultState() {
	return {
		initialized: false,
		playersMessageId: null,
		challengeMessageIds: null,
		players: {},
		playerIds: {},
		challenges: {},
		activeSessions: {},
	};
}

export class MyDurableObject extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		this._rateLimitQueue = [];
		this._rateLimitProcessing = false;
		this._rateLimitBuckets = {};
	}

	async discordFetch(path, options = {}) {
		return new Promise((resolve, reject) => {
			this._rateLimitQueue.push({ path, options, resolve, reject });
			this._processQueue();
		});
	}

	async _processQueue() {
		if (this._rateLimitProcessing || this._rateLimitQueue.length === 0) return;
		this._rateLimitProcessing = true;

		while (this._rateLimitQueue.length > 0) {
			const { path, options, resolve, reject } = this._rateLimitQueue[0];

			const method = (options.method || "GET").toUpperCase();
			const bucketKey = this._rateLimitBucket(method, path);
			const bucket = this._rateLimitBuckets[bucketKey];

			if (bucket && bucket.remaining <= 0 && bucket.resetAt) {
				const wait = bucket.resetAt - Date.now();
				if (wait > 0 && wait < 300000) {
					await new Promise(r => setTimeout(r, wait + 50));
				}
				delete this._rateLimitBuckets[bucketKey];
			}

			const url = `${DISCORD_API}${path}`;
			try {
				const res = await fetch(url, {
					...options,
					headers: {
						Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
						"Content-Type": "application/json",
						...options.headers,
					},
				});

				this._updateRateLimitBucket(bucketKey, res.headers);

				if (res.status === 429) {
					const bodyText = await res.text();
					let retryAfter = 1;
					try {
						retryAfter = JSON.parse(bodyText).retry_after || 1;
					} catch {}
					if (typeof retryAfter !== "number" || retryAfter <= 0) retryAfter = 1;
					if (retryAfter > 300) retryAfter = 300;

					this._rateLimitBuckets[bucketKey] = {
						remaining: 0,
						resetAt: Date.now() + retryAfter * 1000,
					};

					await new Promise(r => setTimeout(r, retryAfter * 1000 + 100));
					continue;
				}

				const text = await res.text();
				if (!res.ok) {
					reject(new Error(`Discord API ${res.status} ${path}: ${text}`));
					this._rateLimitQueue.shift();
					continue;
				}

				resolve(text ? JSON.parse(text) : null);
				this._rateLimitQueue.shift();
			} catch (e) {
				reject(e);
				this._rateLimitQueue.shift();
			}
		}

		this._rateLimitProcessing = false;
	}

	_rateLimitBucket(method, path) {
		const pattern = path.replace(/\/\d{15,21}/g, "/{id}").replace(/\?.*$/, "");
		return `${method}:${pattern}`;
	}

	_updateRateLimitBucket(bucketKey, headers) {
		const remaining = headers.get("X-RateLimit-Remaining");
		const resetAfter = headers.get("X-RateLimit-Reset-After");
		const bucket = headers.get("X-RateLimit-Bucket");

		if (remaining !== null) {
			const key = bucket || bucketKey;
			const after = resetAfter ? parseFloat(resetAfter) : null;
			this._rateLimitBuckets[key] = {
				remaining: parseInt(remaining, 10),
				resetAt: after ? Date.now() + after * 1000 : null,
			};
		}
	}

	async findUserByName(name) {
		try {
			const normalized = normalizeName(name);
			const results = await this.discordFetch(
				`/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(normalized)}&limit=5`,
				{ method: "GET" },
			);
			if (!Array.isArray(results)) return null;
			for (const member of results) {
				const nick = member.nick ? normalizeName(member.nick) : "";
				const username = member.user?.username ? normalizeName(member.user.username) : "";
				const globalName = member.user?.global_name ? normalizeName(member.user.global_name) : "";
				if (nick === normalized || username === normalized || globalName === normalized) {
					return member.user?.id || null;
				}
			}
			return null;
		} catch (_) {
			return null;
		}
	}

	async getState() {
		const stored = await this.ctx.storage.get("state");
		if (stored) {
			if (!stored.playerIds) stored.playerIds = {};
			if (!stored.challengeMessageIds && stored.challengesMessageId) {
				stored.challengeMessageIds = [stored.challengesMessageId];
				delete stored.challengesMessageId;
			}
			return stored;
		}
		const d = defaultState();
		await this.ctx.storage.put("state", d);
		return d;
	}

	async putState(state) {
		await this.ctx.storage.put("state", state);
	}

	renderPlayersBlock(state) {
		const playerChallenges = {};
		for (const [challengeName, ch] of Object.entries(state.challenges)) {
			for (const user of Object.keys(ch.activeUsers)) {
				if (!playerChallenges[user]) playerChallenges[user] = [];
				playerChallenges[user].push(challengeName);
			}
		}
		const names = Object.keys(state.players).sort();
		if (names.length === 0) return "**CTF Team**\n*No players yet*";
		return "**CTF Team**\n" + names.map((n) => {
			const active = playerChallenges[n];
			if (active && active.length > 0) {
				return `- **${n}**: ${active.map((c) => `<#${state.challenges[c].channelId}>`).join(", ")}`;
			}
			return `- **${n}**`;
		}).join("\n");
	}

	renderChallengesBlock(state) {
		const mentions = {};
		for (const [name, id] of Object.entries(state.playerIds || {})) {
			if (id) mentions[name] = `<@${id}>`;
		}
		const entries = Object.entries(state.challenges);
		if (entries.length === 0) return ["**Challenges**\n*No challenges yet*"];
		const lines = entries.map(([name, ch]) => {
			if (ch.currentCategory === "offline-challenges") {
				return `${name}: ***(archived for offline solving. prioritize other challenges)***`;
			}
			if (ch.solved) {
				const solver = mentions[ch.solverName] || `@${ch.solverName || "unknown"}`;
				return `~~${name}~~ *(solved by ${solver})*`;
			}
			const activeUsers = Object.keys(ch.activeUsers);
			if (activeUsers.length > 0) {
				return `${name}: In progress by ${activeUsers.map((u) => mentions[u] || `@${u}`).join(", ")}`;
			}
			return name;
		});
		const header = "**Challenges**";
		const chunks = [];
		let current = header;
		for (const line of lines) {
			const candidate = current + "\n" + line;
			if (candidate.length > 2000) {
				chunks.push(current);
				current = line;
			} else {
				current = candidate;
			}
		}
		if (current) chunks.push(current);
		return chunks;
	}

	async sendChallengeBoard(state) {
		const chunks = this.renderChallengesBlock(state);

		if (state.challengeMessageId && !state.challengeMessageIds) {
			state.challengeMessageIds = [state.challengeMessageId];
			delete state.challengeMessageId;
		}

		const msgIds = [];

		if (state.challengeMessageIds && state.challengeMessageIds.length > 0) {
			for (let i = 0; i < Math.min(chunks.length, state.challengeMessageIds.length); i++) {
				await this.discordFetch(
					`/channels/${PROGRESS_CHANNEL}/messages/${state.challengeMessageIds[i]}`,
					{ method: "PATCH", body: JSON.stringify({ content: chunks[i] }) },
				);
				msgIds.push(state.challengeMessageIds[i]);
			}
			for (let i = state.challengeMessageIds.length; i < chunks.length; i++) {
				const msg = await this.discordFetch(
					`/channels/${PROGRESS_CHANNEL}/messages`,
					{ method: "POST", body: JSON.stringify({ content: chunks[i] }) },
				);
				msgIds.push(msg.id);
			}
		} else {
			for (const chunk of chunks) {
				const msg = await this.discordFetch(
					`/channels/${PROGRESS_CHANNEL}/messages`,
					{ method: "POST", body: JSON.stringify({ content: chunk }) },
				);
				msgIds.push(msg.id);
			}
		}

		state.challengeMessageIds = msgIds;
	}

	async sendPlayerBoard(state) {
		const content = this.renderPlayersBlock(state);
		if (state.playersMessageId) {
			await this.discordFetch(
				`/channels/${PROGRESS_CHANNEL}/messages/${state.playersMessageId}`,
				{ method: "PATCH", body: JSON.stringify({ content }) },
			);
		} else {
			const msg = await this.discordFetch(
				`/channels/${PROGRESS_CHANNEL}/messages`,
				{ method: "POST", body: JSON.stringify({ content }) },
			);
			state.playersMessageId = msg.id;
		}
	}

	async getInitialized() {
		const state = await this.getState();
		return { initialized: state.initialized };
	}

	async listChallenges() {
		const state = await this.getState();
		return Object.keys(state.challenges);
	}

	async adminInit(secret, challengeList) {
		const state = await this.getState();

		if (secret !== this.env.ADMIN_SECRET) {
			throw new Error("Invalid admin secret");
		}

		if (!Array.isArray(challengeList) || challengeList.length === 0) {
			throw new Error("challengeList must be a non-empty array");
		}

		if (state.initialized) {
			throw new Error("Already initialized. Run /adminReset first to reinitialize.");
		}

		const challenges = {};
		for (const name of challengeList) {
			const sname = sanitizeName(name);
			challenges[sname] = {
				channelId: null,
				solverName: null,
				solved: false,
				previousCategory: null,
				currentCategory: null,
				activeUsers: {},
			};
		}
		state.challenges = challenges;

		await this.sendPlayerBoard(state);
		await this.putState(state);

		await this.sendChallengeBoard(state);
		await this.putState(state);

		state.initialized = true;
		await this.putState(state);

		return { playersMessageId: state.playersMessageId, challengeMessageIds: state.challengeMessageIds };
	}

	async adminReset(secret) {
		if (secret !== this.env.ADMIN_SECRET) {
			throw new Error("Invalid admin secret");
		}

		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Nothing to reset. CTF is not initialized.");
		}

		let discordCleanupFailed = false;

		// Delete all messages in the progress channel
		try {
			let done = false;
			let before;
			while (!done) {
				const params = new URLSearchParams();
				params.set("limit", "100");
				if (before) params.set("before", before);
				const messages = await this.discordFetch(
					`/channels/${PROGRESS_CHANNEL}/messages?${params.toString()}`,
					{ method: "GET" },
				);
				if (!Array.isArray(messages) || messages.length === 0) break;
				if (messages.length < 100) done = true;

				const ids = messages.map((m) => m.id);
				before = ids[ids.length - 1];

				try {
					if (ids.length === 1) {
						await this.discordFetch(
							`/channels/${PROGRESS_CHANNEL}/messages/${ids[0]}`,
							{ method: "DELETE" },
						);
					} else {
						await this.discordFetch(
							`/channels/${PROGRESS_CHANNEL}/messages/bulk-delete`,
							{ method: "POST", body: JSON.stringify({ messages: ids }) },
						);
					}
				} catch (_) {
					for (const msgId of ids) {
						try {
							await this.discordFetch(
								`/channels/${PROGRESS_CHANNEL}/messages/${msgId}`,
								{ method: "DELETE" },
							);
						} catch (_) {}
					}
				}
			}
		} catch (_) {
			discordCleanupFailed = true;
		}

		// Delete all channels in CTF categories
		const categories = [CTF_CHALLENGES_CATEGORY, HELP_ME_CATEGORY, FINISHED_CHALLENGES_CATEGORY, OFFLINE_CHALLENGES_CATEGORY];
		try {
			const channels = await this.discordFetch(
				`/guilds/${GUILD_ID}/channels`,
				{ method: "GET" },
			);
			if (Array.isArray(channels)) {
				for (const ch of channels) {
					if (categories.includes(ch.parent_id)) {
						try {
							await this.discordFetch(
								`/channels/${ch.id}`,
								{ method: "DELETE" },
							);
						} catch (_) {}
					}
				}
			}
		} catch (_) {
			discordCleanupFailed = true;
		}

		if (discordCleanupFailed) {
			throw new Error("Discord cleanup partially failed. DO state preserved. Try again or manually clean Discord.");
		}

		await this.ctx.storage.put("state", defaultState());
		return { reset: true };
	}

	async initUser(displayName, userId) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}

		const normalizedName = normalizeName(displayName);

		if (state.players[normalizedName]) {
			return { displayName: normalizedName, wasNew: false, message: "Already registered. No need to run /init again." };
		}

		const wasNew = true;
		state.players[normalizedName] = true;
		if (userId) {
			state.playerIds[normalizedName] = userId;
		} else if (!state.playerIds || !state.playerIds[normalizedName]) {
			const foundId = await this.findUserByName(normalizedName);
			if (foundId) {
				state.playerIds[normalizedName] = foundId;
			}
		}

		await this.sendPlayerBoard(state);

		await this.putState(state);

		return { displayName: normalizedName, wasNew };
	}

	async startChallenge(user, challengeName, sessionId) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		const sname = sanitizeName(challengeName);
		const challenge = state.challenges[sname];
		if (!challenge) {
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (challenge.solved) {
			throw new Error(`Challenge "${sname}" is already solved.`);
		}
		if (challenge.currentCategory === "offline-challenges") {
			throw new Error(`Challenge "${sname}" is archived. Run /undoArchive first.`);
		}

		if (state.activeSessions[sessionId]) {
			throw new Error("This session has already been used. Start a fresh session.");
		}

		let channelId = challenge.channelId;
		if (!channelId) {
			const channel = await this.discordFetch(
				`/guilds/${GUILD_ID}/channels`,
				{
					method: "POST",
				body: JSON.stringify({
					name: sname,
					type: 0,
					parent_id: CTF_CHALLENGES_CATEGORY,
				}),
			},
		);
		channelId = channel.id;
		challenge.channelId = channelId;
		challenge.currentCategory = "ctf-challenges";
		await this.putState(state);
	}

	const starterMsg = await this.discordFetch(
		`/channels/${channelId}/messages`,
		{
			method: "POST",
			body: JSON.stringify({
				content: `**${user}** started working on this challenge.`,
			}),
		},
	);

	const thread = await this.discordFetch(
		`/channels/${channelId}/messages/${starterMsg.id}/threads`,
		{
			method: "POST",
			body: JSON.stringify({
				name: user,
				auto_archive_duration: 10080,
			}),
		},
	);

	challenge.activeUsers[user] = true;
	state.activeSessions[sessionId] = { challengeName: sname, threadId: thread.id };

	await this.sendPlayerBoard(state);
	await this.sendChallengeBoard(state);

	await this.putState(state);

	return { channelId, threadId: thread.id, challengeName: sname };
	}

	async finishChallenge(user, channelId) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		let found = null;
		for (const [name, ch] of Object.entries(state.challenges)) {
			if (ch.channelId === channelId) {
				found = { name, challenge: ch };
				break;
			}
		}
		if (!found) {
			throw new Error("No challenge found for this channel.");
		}

		const { name, challenge } = found;
		if (challenge.solved) {
			throw new Error(`Challenge "${name}" is already marked as solved.`);
		}
		if (challenge.currentCategory === "offline-challenges") {
			throw new Error(`Challenge "${name}" is archived. Run /undoArchive first.`);
		}

		if (!challenge.activeUsers[user]) {
			throw new Error(`You haven't started working on "${name}". Run /start first.`);
		}

		delete challenge.activeUsers[user];

		const remaining = Object.keys(challenge.activeUsers).length;

		if (remaining === 0) {
			challenge.previousCategory = challenge.currentCategory;
			challenge.currentCategory = "finished-challenges";
			challenge.solved = true;
			challenge.solverName = user;

			await this.discordFetch(
				`/channels/${channelId}`,
				{
					method: "PATCH",
					body: JSON.stringify({ parent_id: FINISHED_CHALLENGES_CATEGORY }),
				},
			);

			await this.sendPlayerBoard(state);
			await this.sendChallengeBoard(state);

			await this.putState(state);
			return { moved: true, challengeName: name, solverName: user };
		}

		await this.sendPlayerBoard(state);
		await this.putState(state);
		return { moved: false, challengeName: name, remainingActiveUsers: remaining };
	}

	async helpmeChallenge(user, channelId) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		let found = null;
		for (const [name, ch] of Object.entries(state.challenges)) {
			if (ch.channelId === channelId) {
				found = { name, challenge: ch };
				break;
			}
		}
		if (!found) {
			throw new Error("No challenge found for this channel.");
		}

		const { name, challenge } = found;
		if (challenge.solved) {
			throw new Error(`Challenge "${name}" is already solved. Cannot request help.`);
		}
		if (challenge.currentCategory === "offline-challenges") {
			throw new Error(`Challenge "${name}" is archived. Run /undoArchive first.`);
		}
		if (!challenge.activeUsers[user]) {
			throw new Error(`You haven't started working on "${name}". Run /start first.`);
		}
		if (challenge.currentCategory === "help-me") {
			return { moved: false, challengeName: name, message: "Already in help-me." };
		}

		challenge.previousCategory = challenge.currentCategory;
		challenge.currentCategory = "help-me";

		await this.discordFetch(
			`/channels/${channelId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ parent_id: HELP_ME_CATEGORY }),
			},
		);

		await this.putState(state);
		return { moved: true, challengeName: name };
	}

	async undoFinishChallenge(user, challengeName) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		const sname = sanitizeName(challengeName);
		const challenge = state.challenges[sname];
		if (!challenge) {
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (!challenge.solved) {
			throw new Error(`Challenge "${sname}" is not solved. Nothing to undo.`);
		}
		if (challenge.solverName !== user) {
			throw new Error(`Only ${challenge.solverName} (the solver) can undo this finish.`);
		}
		if (!challenge.previousCategory) {
			throw new Error(`Cannot undo: previous category not recorded for "${sname}".`);
		}

		const targetCategory =
			challenge.previousCategory === "help-me"
				? HELP_ME_CATEGORY
				: CTF_CHALLENGES_CATEGORY;

		await this.discordFetch(
			`/channels/${challenge.channelId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ parent_id: targetCategory }),
			},
		);

		challenge.solved = false;
		challenge.currentCategory = challenge.previousCategory;
		challenge.previousCategory = null;
		challenge.activeUsers = {};
		if (challenge.solverName && state.players[challenge.solverName]) {
			challenge.activeUsers[challenge.solverName] = true;
		}
		challenge.solverName = null;

		await this.sendChallengeBoard(state);
		await this.sendPlayerBoard(state);

		await this.putState(state);
		return { challengeName: sname, channelId: challenge.channelId, restoredTo: challenge.currentCategory };
	}

	async undoStartChallenge(user, challengeName) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		const sname = sanitizeName(challengeName);
		const challenge = state.challenges[sname];
		if (!challenge) {
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (challenge.solved) {
			throw new Error(`Challenge "${sname}" is already solved. Cannot undo start.`);
		}
		if (!challenge.activeUsers[user]) {
			throw new Error(`You haven't started "${sname}". Nothing to undo.`);
		}

		delete challenge.activeUsers[user];

	for (const [sessionId, entry] of Object.entries(state.activeSessions)) {
			if (entry.challengeName === sname && sessionId.startsWith(user + "-")) {
				delete state.activeSessions[sessionId];
			}
		}

	await this.sendPlayerBoard(state);

	await this.putState(state);
	return { challengeName: sname, user };
}

async archiveChallenge(user, challengeName) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		const sname = sanitizeName(challengeName);
		const challenge = state.challenges[sname];
		if (!challenge) {
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (challenge.solved) {
			throw new Error(`Challenge "${sname}" is already solved.`);
		}
		if (Object.keys(challenge.activeUsers).length > 0) {
			throw new Error(`Challenge "${sname}" has active users. Cannot archive.`);
		}
		if (challenge.currentCategory === "offline-challenges") {
			return { channelId: challenge.channelId, challengeName: sname, message: "Already archived." };
		}

		let channelId = challenge.channelId;
		if (!channelId) {
			const channel = await this.discordFetch(
				`/guilds/${GUILD_ID}/channels`,
				{
					method: "POST",
				body: JSON.stringify({
					name: sname,
					type: 0,
					parent_id: OFFLINE_CHALLENGES_CATEGORY,
				}),
			},
		);
		channelId = channel.id;
		challenge.channelId = channelId;
	} else {
		await this.discordFetch(
			`/channels/${channelId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ parent_id: OFFLINE_CHALLENGES_CATEGORY }),
			},
		);
	}

	challenge.previousCategory = challenge.currentCategory;
	challenge.currentCategory = "offline-challenges";

	await this.discordFetch(
		`/channels/${channelId}/messages`,
		{
			method: "POST",
			body: JSON.stringify({
				content: "***This challenge is archived for offline solving. Prioritize other challenges.***",
			}),
		},
	);

	await this.sendChallengeBoard(state);
	await this.putState(state);

	return { channelId, challengeName: sname };
	}

	async undoArchiveChallenge(user, challengeName) {
		const state = await this.getState();

		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		const sname = sanitizeName(challengeName);
		const challenge = state.challenges[sname];
		if (!challenge) {
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (challenge.currentCategory !== "offline-challenges") {
			throw new Error(`Challenge "${sname}" is not archived.`);
		}

		await this.discordFetch(
			`/channels/${challenge.channelId}`,
			{
				method: "PATCH",
				body: JSON.stringify({ parent_id: CTF_CHALLENGES_CATEGORY }),
			},
		);

		challenge.currentCategory = challenge.previousCategory || null;
		challenge.previousCategory = null;

		await this.sendChallengeBoard(state);
		await this.putState(state);

		return { channelId: challenge.channelId, challengeName: sname };
	}

	async syncMessage(channelId, user, content, thinking) {
		const state = await this.getState();
		if (!state.initialized) {
			throw new Error("Admin has not initialized challenges yet. Wait for /adminInit.");
		}
		if (!state.players[user]) {
			throw new Error("You haven't run /init yet. Run /init first.");
		}

		let message = content;
		if (thinking) {
			const quotedThinking = thinking.split("\n").map(line => `> ${line}`).join("\n");
			message = `${quotedThinking}\n${content}`;
		}

		const MAX_CHUNK = 2000;
		const lines = message.split("\n");
		let current = lines[0];
		for (let i = 1; i < lines.length; i++) {
			const candidate = current + "\n" + lines[i];
			if (candidate.length > MAX_CHUNK) {
				await this.discordFetch(
					`/channels/${channelId}/messages`,
					{ method: "POST", body: JSON.stringify({ content: current }) },
				);
				current = lines[i];
			} else {
				current = candidate;
			}
		}
		if (current.trim()) {
			await this.discordFetch(
				`/channels/${channelId}/messages`,
				{ method: "POST", body: JSON.stringify({ content: current }) },
			);
		}

		return { sent: true };
	}

	async lookupChallenge(channelId, challengeName) {
		const state = await this.getState();
		if (challengeName) {
			const sname = sanitizeName(challengeName);
			const ch = state.challenges[sname];
			if (ch) {
				return { challengeName: sname, solved: ch.solved, solverName: ch.solverName, channelId: ch.channelId };
			}
			throw new Error(`Challenge "${sname}" not found.`);
		}
		if (channelId) {
			for (const [name, ch] of Object.entries(state.challenges)) {
				if (ch.channelId === channelId) {
					return { challengeName: name, solved: ch.solved, solverName: ch.solverName, channelId };
				}
			}
		}
		throw new Error("No challenge found. Provide channelId or challengeName.");
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const path = url.pathname;

		const stub = env.MY_DURABLE_OBJECT.get(
			env.MY_DURABLE_OBJECT.idFromName("main"),
		);

		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				},
			});
		}

		try {
			let body = {};
			if (request.method === "POST") {
				try {
					body = await request.json();
					if (typeof body.user === "string") {
						body.user = normalizeName(body.user);
					}
				} catch (_) {
					return err("Invalid JSON body", 400);
				}
			}

			let result;

			switch (path) {
				case "/adminInit": {
					result = await stub.adminInit(body.secret, body.challenges);
					break;
				}
				case "/adminReset": {
					result = await stub.adminReset(body.secret);
					break;
				}
				case "/init": {
					result = await stub.initUser(body.user, body.userId);
					break;
				}
				case "/start": {
					result = await stub.startChallenge(body.user, body.challenge, body.sessionId);
					break;
				}
				case "/finish": {
					result = await stub.finishChallenge(body.user, body.channelId);
					break;
				}
				case "/helpme": {
					result = await stub.helpmeChallenge(body.user, body.channelId);
					break;
				}
				case "/undoFinish": {
					result = await stub.undoFinishChallenge(body.user, body.challengeName);
					break;
				}
			case "/undoStart": {
				result = await stub.undoStartChallenge(body.user, body.challengeName);
				break;
			}
			case "/archive": {
				result = await stub.archiveChallenge(body.user, body.challenge);
				break;
			}
			case "/undoArchive": {
				result = await stub.undoArchiveChallenge(body.user, body.challengeName);
				break;
			}
			case "/syncMessage": {
				result = await stub.syncMessage(body.channelId, body.user, body.content, body.thinking);
				break;
			}
				case "/lookup": {
					result = await stub.lookupChallenge(body.channelId, body.challengeName);
					break;
				}
				case "/initialized": {
					result = await stub.getInitialized();
					break;
				}
			case "/challenges": {
				result = await stub.listChallenges();
				break;
			}
				default:
					return err("Not found", 404);
			}

			return json({ ok: true, data: result }, 200);
		} catch (e) {
			return err(e.message || "Internal error", 400);
		}
	},
};
