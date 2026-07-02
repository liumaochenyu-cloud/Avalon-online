import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";

const rooms = new Map();

const ROLE_LIBRARY = {
  servant: {
    name: "忠臣",
    emoji: "🛡️",
    team: "good",
    intro: "好人阵营。你没有额外信息，靠发言和任务结果找出坏人。",
  },
  merlin: {
    name: "梅林",
    emoji: "🧙",
    team: "good",
    intro: "你知道大多数坏人是谁，但要隐藏自己，避免最后被刺杀。",
  },
  percival: {
    name: "派西维尔",
    emoji: "🦉",
    team: "good",
    intro: "你会看见梅林候选人。如果有莫甘娜，她会混在候选人里。",
  },
  minion: {
    name: "爪牙",
    emoji: "🗡️",
    team: "evil",
    intro: "坏人阵营。你知道大多数坏人同伴，可以在任务里选择破坏。",
  },
  assassin: {
    name: "刺客",
    emoji: "🎯",
    team: "evil",
    intro: "坏人阵营。好人三次任务成功后，你可以刺杀梅林逆转。",
  },
  morgana: {
    name: "莫甘娜",
    emoji: "🪞",
    team: "evil",
    intro: "坏人阵营。你会伪装成派西维尔眼里的梅林候选人。",
  },
  mordred: {
    name: "莫德雷德",
    emoji: "🦇",
    team: "evil",
    intro: "坏人阵营。你不会被梅林看见。",
  },
  oberon: {
    name: "奥伯伦",
    emoji: "🌫️",
    team: "evil",
    intro: "坏人阵营。你不知道其他坏人，其他坏人也不知道你。",
  },
};

const PRESETS = {
  minimal7: { servant: 4, minion: 3 },
  standard7: { merlin: 1, percival: 1, servant: 2, assassin: 1, morgana: 1, minion: 1 },
  starter5: { merlin: 1, servant: 2, assassin: 1, minion: 1 },
};

const AVATAR_CHOICES = ["🧙", "🛡️", "🦊", "🐲", "🍄", "🌙", "⚔️", "👑", "🎲", "🥨", "🧃", "🚀"];

const QUEST_SIZES = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function localNetworkAddresses() {
  const entries = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses || [])
      .filter((address) => address.family === "IPv4" && !address.internal)
      .map((address) => ({ name, address: address.address }))
  );
  return entries.sort((a, b) => {
    const score = (entry) => {
      const name = entry.name.toLowerCase();
      const address = entry.address;
      if (name.includes("wlan") || name.includes("wi-fi") || name.includes("wireless") || name.includes("无线")) return 0;
      if (address.startsWith("192.168.") && !address.endsWith(".1")) return 1;
      if (address.startsWith("10.") && !address.endsWith(".1")) return 2;
      if (address.startsWith("172.")) return 3;
      if (address.startsWith("192.168.")) return 4;
      if (address.startsWith("10.")) return 5;
      return 9;
    };
    return score(a) - score(b);
  });
}

function preferredOrigin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const requestHost = req?.headers?.host || `127.0.0.1:${port}`;
  const hostName = requestHost.split(":")[0];
  if (!["127.0.0.1", "localhost", "::1"].includes(hostName)) return `http://${requestHost}`;
  const address = localNetworkAddresses()[0]?.address;
  return `http://${address || "127.0.0.1"}:${port}`;
}

function json(res, status, payload) {
  res.writeHead(status, corsHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(payload));
}

function fail(res, status, message) {
  json(res, status, { error: message });
}

function corsHeaders(headers = {}) {
  return {
    "access-control-allow-origin": process.env.CORS_ORIGIN || "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    ...headers,
  };
}

function serveEnv(req, res) {
  const payload = {
    VITE_API_URL: process.env.VITE_API_URL || "",
    VITE_SOCKET_URL: process.env.VITE_SOCKET_URL || "",
  };
  res.writeHead(200, corsHeaders({ "content-type": "text/javascript; charset=utf-8" }));
  res.end(`window.__AVALON_ENV__ = ${JSON.stringify(payload)};`);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求 JSON 格式不正确");
    error.status = 400;
    throw error;
  }
}

function randomId(size = 16) {
  return crypto.randomBytes(size).toString("hex");
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function newRoomCode() {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();
  return code;
}

function sanitizeAvatar(avatar) {
  const value = String(avatar || "").trim();
  if (!value) return AVATAR_CHOICES[Math.floor(Math.random() * AVATAR_CHOICES.length)];
  if (/^https?:\/\//i.test(value)) return value.slice(0, 240);
  return [...value].slice(0, 4).join("") || AVATAR_CHOICES[Math.floor(Math.random() * AVATAR_CHOICES.length)];
}

function createPlayer(name, avatar) {
  return {
    id: randomId(8),
    secret: randomId(16),
    name: String(name || "").trim().slice(0, 20) || "玩家",
    avatar: sanitizeAvatar(avatar),
    joinedAt: Date.now(),
  };
}

function createRoom(hostName, avatar) {
  const code = newRoomCode();
  const hostPlayer = createPlayer(hostName || "房主", avatar);
  const room = {
    code,
    hostId: hostPlayer.id,
    createdAt: Date.now(),
    stage: "lobby",
    players: [hostPlayer],
    roleCounts: { ...PRESETS.minimal7 },
    assignments: new Map(),
    leaderIndex: 0,
    proposal: null,
    teamVotes: new Map(),
    missionCards: new Map(),
    missionResults: [],
    lastVote: null,
    lastMission: null,
    assassination: null,
    forceEnded: null,
    clients: new Set(),
  };
  rooms.set(code, room);
  return { room, player: hostPlayer };
}

function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) {
    const error = new Error("房间不存在");
    error.status = 404;
    throw error;
  }
  return room;
}

function requirePlayer(room, bodyOrParams) {
  const playerId = bodyOrParams.playerId;
  const secret = bodyOrParams.secret;
  const player = room.players.find((item) => item.id === playerId && item.secret === secret);
  if (!player) {
    const error = new Error("玩家身份校验失败");
    error.status = 401;
    throw error;
  }
  return player;
}

function requireHost(room, player) {
  if (room.hostId !== player.id) {
    const error = new Error("只有房主可以操作");
    error.status = 403;
    throw error;
  }
}

function canManageRoster(room) {
  return room.stage === "lobby" || room.stage === "finished";
}

function requireRosterUnlocked(room, message = "游戏进行中不能变更玩家") {
  if (!canManageRoster(room)) {
    const error = new Error(message);
    error.status = 409;
    throw error;
  }
}

function roleTotal(room) {
  return Object.values(room.roleCounts).reduce((sum, count) => sum + count, 0);
}

function questSizes(playerCount) {
  return QUEST_SIZES[playerCount] || QUEST_SIZES[7];
}

function teamSize(room) {
  return questSizes(room.players.length)[Math.min(room.missionResults.length, 4)];
}

function failThreshold(room, roundIndex = room.missionResults.length) {
  return room.players.length >= 7 && roundIndex === 3 ? 2 : 1;
}

function expandedRoles(room) {
  return Object.entries(room.roleCounts).flatMap(([roleId, count]) => Array.from({ length: count }, () => roleId));
}

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function roleOptions(room) {
  return Object.entries(ROLE_LIBRARY).map(([id, role]) => ({
    id,
    ...role,
    count: room.roleCounts[id] || 0,
  }));
}

function publicPlayer(room, player) {
  return {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    isHost: player.id === room.hostId,
    isLeader: room.players[room.leaderIndex]?.id === player.id,
    connected: [...room.clients].some((client) => client.playerId === player.id),
  };
}

function removePlayerFromRoom(room, playerId, reason = "你已离开房间") {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) return false;

  for (const client of [...room.clients]) {
    if (client.playerId === playerId) {
      sendEvent(client, "removed", { reason });
      client.res.end();
      room.clients.delete(client);
    }
  }

  room.players = room.players.filter((item) => item.id !== playerId);
  room.assignments.delete(playerId);
  room.teamVotes.delete(playerId);
  room.missionCards.delete(playerId);
  if (room.proposal) {
    room.proposal.teamIds = room.proposal.teamIds.filter((id) => id !== playerId);
  }
  if (room.assassination?.assassinId === playerId || room.assassination?.merlinId === playerId) {
    room.assassination = null;
  }
  if (room.hostId === playerId && room.players.length) {
    room.hostId = room.players[0].id;
  }
  room.leaderIndex = room.players.length ? Math.min(room.leaderIndex, room.players.length - 1) : 0;

  if (!room.players.length) {
    rooms.delete(room.code);
  }
  return true;
}

function dissolveRoom(room, reason = "房间已被房主解散") {
  for (const client of [...room.clients]) {
    sendEvent(client, "removed", { reason });
    client.res.end();
    room.clients.delete(client);
  }
  room.players = [];
  rooms.delete(room.code);
}

function assignmentEntries(room) {
  return room.players.map((player) => {
    const assignment = room.assignments.get(player.id);
    return {
      player,
      roleId: assignment?.roleId,
      role: assignment ? ROLE_LIBRARY[assignment.roleId] : null,
    };
  });
}

function formatNames(entries, fallback) {
  if (!entries.length) return fallback;
  return entries.map((entry) => entry.player.name).join("、");
}

function privateKnowledge(room, playerId) {
  const assignment = room.assignments.get(playerId);
  if (!assignment) return [];
  const role = ROLE_LIBRARY[assignment.roleId];
  const entries = assignmentEntries(room);
  const self = entries.find((entry) => entry.player.id === playerId);
  const evilEntries = entries.filter((entry) => entry.role?.team === "evil");

  if (role.name === "梅林") {
    const visible = evilEntries.filter((entry) => entry.role.name !== "莫德雷德");
    return [{ label: "你看见的坏人", value: formatNames(visible, "没有可见坏人") }];
  }

  if (role.name === "派西维尔") {
    const candidates = entries.filter((entry) => ["梅林", "莫甘娜"].includes(entry.role?.name));
    return [{ label: "梅林候选", value: formatNames(candidates, "没有梅林候选") }];
  }

  if (role.team === "evil" && role.name !== "奥伯伦") {
    const known = evilEntries.filter((entry) => entry.player.id !== playerId && entry.role.name !== "奥伯伦");
    return [{ label: "坏人同伴", value: formatNames(known, "没有已知同伴") }];
  }

  if (role.name === "奥伯伦") {
    return [{ label: "特殊规则", value: "你不知道其他坏人，其他坏人也不知道你。" }];
  }

  return [{ label: "已知信息", value: self?.role?.team === "good" ? "你没有额外信息。" : "按房间规则行动。" }];
}

function publicMission(mission, revealChoices = false) {
  const visible = {
    result: mission.result,
    cards: mission.cards,
    failCards: mission.failCards,
    successCards: mission.successCards,
    threshold: mission.threshold,
    teamIds: mission.teamIds,
    roundIndex: mission.roundIndex,
  };
  if (revealChoices) {
    visible.choices = mission.choices || [];
  }
  return visible;
}

function findAssignmentByRole(room, roleId) {
  return assignmentEntries(room).find((entry) => entry.roleId === roleId) || null;
}

function getWinner(room) {
  if (room.forceEnded) return "canceled";
  const successTotal = room.missionResults.filter((item) => item.result === "success").length;
  const failTotal = room.missionResults.filter((item) => item.result === "fail").length;
  if (failTotal >= 3) return "evil";
  if (room.assassination?.targetId) return room.assassination.hit ? "evil" : "good";
  if (room.stage === "finished" && successTotal >= 3) return "good";
  if (room.stage === "finished" && room.missionResults.length >= 5) return successTotal >= 3 ? "good" : "evil";
  return null;
}

function maybeStartAssassination(room) {
  const merlin = findAssignmentByRole(room, "merlin");
  const assassin = findAssignmentByRole(room, "assassin");
  if (merlin && assassin) {
    room.assassination = {
      assassinId: assassin.player.id,
      merlinId: merlin.player.id,
      targetId: null,
      hit: null,
    };
    room.stage = "assassination";
    return;
  }
  room.stage = "finished";
}

function buildSnapshot(room, playerId) {
  const player = room.players.find((item) => item.id === playerId);
  const assignment = player ? room.assignments.get(player.id) : null;
  const role = assignment ? ROLE_LIBRARY[assignment.roleId] : null;
  const proposedTeam = room.proposal?.teamIds || [];
  const isOnTeam = proposedTeam.includes(playerId);
  const leader = room.players[room.leaderIndex];
  const winner = getWinner(room);

  const isFinished = room.stage === "finished";
  const revealedRoles =
    isFinished
      ? assignmentEntries(room).map((entry) => ({
          playerId: entry.player.id,
          name: entry.player.name,
          avatar: entry.player.avatar,
          role: entry.role ? { id: entry.roleId, ...entry.role } : null,
        }))
      : [];
  const publicMissionResults = room.missionResults.map((mission) => publicMission(mission, isFinished));
  const publicLastMission = room.lastMission ? publicMission(room.lastMission, isFinished) : null;

  return {
    code: room.code,
    inviteUrl: `${preferredOrigin()}/?room=${room.code}`,
    stage: room.stage,
    createdAt: room.createdAt,
    hostId: room.hostId,
    leaderId: leader?.id || null,
    players: room.players.map((item) => publicPlayer(room, item)),
    canManageRoster: canManageRoster(room),
    roles: roleOptions(room),
    roleTotal: roleTotal(room),
    playerTotal: room.players.length,
    configValid: room.players.length >= 5 && room.players.length <= 10 && roleTotal(room) === room.players.length,
    questSizes: questSizes(room.players.length),
    roundIndex: room.missionResults.length,
    currentTeamSize: room.missionResults.length < 5 ? teamSize(room) : 0,
    currentFailThreshold: failThreshold(room),
    proposal: room.proposal
      ? {
          teamIds: room.proposal.teamIds,
          leaderId: room.proposal.leaderId,
          roundIndex: room.proposal.roundIndex,
        }
      : null,
    voteStatus: room.players.map((item) => ({
      playerId: item.id,
      submitted: room.teamVotes.has(item.id),
    })),
    missionStatus: proposedTeam.map((id) => ({
      playerId: id,
      submitted: room.missionCards.has(id),
    })),
    missionResults: publicMissionResults,
    lastVote: room.lastVote,
    lastMission: publicLastMission,
    revealedRoles,
    forceEnded: isFinished ? room.forceEnded : null,
    assassination: room.assassination
      ? {
          submitted: Boolean(room.assassination.targetId),
          targetId: isFinished ? room.assassination.targetId : null,
          targetName: isFinished ? room.assassination.targetName : null,
          targetAvatar: isFinished ? room.assassination.targetAvatar : null,
          hit: isFinished ? room.assassination.hit : null,
        }
      : null,
    winner,
    self: player
      ? {
          id: player.id,
          name: player.name,
          isHost: player.id === room.hostId,
          isLeader: leader?.id === player.id,
          isOnTeam,
          role: role ? { id: assignment.roleId, ...role } : null,
          knowledge: privateKnowledge(room, player.id),
          vote: room.teamVotes.get(player.id) || null,
          missionSubmitted: room.missionCards.has(player.id),
          canPlayFail: Boolean(role && role.team === "evil"),
          canAssassinate: Boolean(room.stage === "assassination" && room.assassination?.assassinId === player.id && !room.assassination.targetId),
        }
      : null,
  };
}

function sendEvent(client, event, payload) {
  client.res.write(`event: ${event}\n`);
  client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(room) {
  for (const client of room.clients) {
    sendEvent(client, "snapshot", buildSnapshot(room, client.playerId));
  }
}

function credential(room, player, req) {
  const origin = preferredOrigin(req);
  return {
    roomCode: room.code,
    playerId: player.id,
    secret: player.secret,
    playerName: player.name,
    playerAvatar: player.avatar,
    joinUrl: `${origin}/?room=${room.code}`,
  };
}

function advanceLeader(room) {
  if (!room.players.length) return;
  room.leaderIndex = (room.leaderIndex + 1) % room.players.length;
}

function clearRoundInputs(room) {
  room.proposal = null;
  room.teamVotes.clear();
  room.missionCards.clear();
}

function deal(room) {
  const roles = expandedRoles(room);
  if (roles.length !== room.players.length) {
    const error = new Error("身份数量必须等于已加入玩家数");
    error.status = 400;
    throw error;
  }
  if (room.players.length < 5 || room.players.length > 10) {
    const error = new Error("当前原型支持 5-10 人");
    error.status = 400;
    throw error;
  }
  room.assignments.clear();
  shuffle(roles).forEach((roleId, index) => {
    room.assignments.set(room.players[index].id, { roleId });
  });
  room.stage = "proposal";
  room.leaderIndex = 0;
  room.missionResults = [];
  room.lastVote = null;
  room.lastMission = null;
  room.assassination = null;
  room.forceEnded = null;
  clearRoundInputs(room);
}

function finalizeVote(room) {
  if (room.teamVotes.size !== room.players.length || !room.proposal) return;
  const votes = [...room.teamVotes.values()];
  const approve = votes.filter((vote) => vote === "approve").length;
  const reject = votes.length - approve;
  const approved = approve > reject;
  room.lastVote = {
    approve,
    reject,
    approved,
    teamIds: room.proposal.teamIds,
    roundIndex: room.proposal.roundIndex,
  };
  room.teamVotes.clear();

  if (approved) {
    room.stage = "mission";
  } else {
    room.proposal = null;
    room.stage = "proposal";
    advanceLeader(room);
  }
}

function finalizeMission(room) {
  if (!room.proposal || room.missionCards.size !== room.proposal.teamIds.length) return;
  const cards = [...room.missionCards.values()];
  const choices = room.proposal.teamIds.map((playerId) => {
    const card = room.missionCards.get(playerId);
    const player = room.players.find((item) => item.id === playerId);
    return {
      playerId,
      name: player?.name || "离场玩家",
      avatar: player?.avatar || "🎲",
      card,
      symbol: card === "success" ? "✅" : "❌",
    };
  });
  const failCards = cards.filter((card) => card === "fail").length;
  const successCards = cards.length - failCards;
  const publicCards = shuffle(cards).map((card) => (card === "success" ? "✅" : "❌"));
  const threshold = failThreshold(room, room.proposal.roundIndex);
  const result = failCards >= threshold ? "fail" : "success";
  const mission = {
    result,
    cards: publicCards,
    choices,
    failCards,
    successCards,
    threshold,
    teamIds: room.proposal.teamIds,
    roundIndex: room.proposal.roundIndex,
  };
  room.missionResults.push(mission);
  room.lastMission = mission;
  room.missionCards.clear();
  room.proposal = null;
  advanceLeader(room);

  const successTotal = room.missionResults.filter((item) => item.result === "success").length;
  const failTotal = room.missionResults.filter((item) => item.result === "fail").length;
  if (failTotal >= 3) {
    room.stage = "finished";
  } else if (successTotal >= 3) {
    maybeStartAssassination(room);
  } else if (room.missionResults.length >= 5) {
    room.stage = "finished";
  } else {
    room.stage = "proposal";
  }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const body = await readBody(req);

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const { room, player } = createRoom(body.name, body.avatar);
    json(res, 201, credential(room, player, req));
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "rooms" && parts[3] === "join") {
    const room = getRoom(parts[2]);
    if (room.stage !== "lobby") {
      fail(res, 409, "房间已开始，暂时不能加入");
      return;
    }
    if (room.players.length >= 10) {
      fail(res, 409, "房间已满");
      return;
    }
    const player = createPlayer(body.name, body.avatar);
    room.players.push(player);
    json(res, 201, credential(room, player, req));
    broadcast(room);
    return;
  }

  if (parts[0] !== "api" || parts[1] !== "rooms" || !parts[2]) {
    fail(res, 404, "接口不存在");
    return;
  }

  const room = getRoom(parts[2]);
  const player = requirePlayer(room, body);
  const action = parts[3];

  if (req.method === "POST" && action === "preset") {
    requireHost(room, player);
    if (room.stage !== "lobby") return fail(res, 409, "开局后不能改身份");
    if (!PRESETS[body.preset]) return fail(res, 400, "预设不存在");
    room.roleCounts = { ...PRESETS[body.preset] };
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "role") {
    requireHost(room, player);
    if (room.stage !== "lobby") return fail(res, 409, "开局后不能改身份");
    const roleId = body.roleId;
    const delta = Number(body.delta);
    if (!ROLE_LIBRARY[roleId] || !Number.isFinite(delta)) return fail(res, 400, "身份参数不正确");
    room.roleCounts[roleId] = Math.max(0, (room.roleCounts[roleId] || 0) + delta);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "deal") {
    requireHost(room, player);
    if (room.stage !== "lobby") return fail(res, 409, "当前不能发牌");
    deal(room);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "leave") {
    requireRosterUnlocked(room, "游戏进行中不能退出");
    if (room.hostId === player.id) return fail(res, 409, "房主不能直接退出，请先转让房主或解散房间");
    removePlayerFromRoom(room, player.id, "你已离开房间");
    json(res, 200, { ok: true });
    if (rooms.has(room.code)) broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "kick") {
    requireHost(room, player);
    requireRosterUnlocked(room, "游戏进行中不能踢人");
    const targetId = String(body.targetId || "");
    if (!targetId) return fail(res, 400, "缺少目标玩家");
    if (targetId === player.id) return fail(res, 400, "房主不能踢自己，请使用离开房间");
    if (!room.players.some((item) => item.id === targetId)) return fail(res, 404, "目标玩家不存在");
    removePlayerFromRoom(room, targetId, "你已被房主移出房间");
    json(res, 200, { ok: true });
    if (rooms.has(room.code)) broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "transfer-host") {
    requireHost(room, player);
    requireRosterUnlocked(room, "游戏进行中不能转让房主");
    const targetId = String(body.targetId || "");
    if (!targetId) return fail(res, 400, "缺少目标玩家");
    if (targetId === player.id) return fail(res, 400, "不能把房主转让给自己");
    const target = room.players.find((item) => item.id === targetId);
    if (!target) return fail(res, 404, "目标玩家不存在");
    room.hostId = target.id;
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "dissolve") {
    requireHost(room, player);
    requireRosterUnlocked(room, "游戏进行中不能解散房间");
    json(res, 200, { ok: true });
    dissolveRoom(room);
    return;
  }

  if (req.method === "POST" && action === "force-end") {
    requireHost(room, player);
    if (room.stage === "lobby") return fail(res, 409, "对局还没开始，不需要强制结束");
    if (room.stage === "finished") return fail(res, 409, "对局已经结束");
    room.forceEnded = {
      byPlayerId: player.id,
      byName: player.name,
      at: Date.now(),
    };
    room.stage = "finished";
    clearRoundInputs(room);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "propose") {
    if (room.stage !== "proposal") return fail(res, 409, "当前不能提名队伍");
    const leader = room.players[room.leaderIndex];
    if (player.id !== leader?.id) return fail(res, 403, "只有当前队长可以提名队伍");
    const teamIds = [...new Set(Array.isArray(body.teamIds) ? body.teamIds : [])];
    if (teamIds.length !== teamSize(room)) return fail(res, 400, `当前任务需要 ${teamSize(room)} 人`);
    if (!teamIds.every((id) => room.players.some((item) => item.id === id))) return fail(res, 400, "队伍里有不存在的玩家");
    room.proposal = {
      teamIds,
      leaderId: player.id,
      roundIndex: room.missionResults.length,
    };
    room.stage = "voting";
    room.teamVotes.clear();
    room.lastVote = null;
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "vote") {
    if (room.stage !== "voting" || !room.proposal) return fail(res, 409, "当前不能投组队票");
    if (room.teamVotes.has(player.id)) return fail(res, 409, "你已经提交过组队投票");
    const vote = body.vote === "approve" ? "approve" : body.vote === "reject" ? "reject" : null;
    if (!vote) return fail(res, 400, "投票参数不正确");
    room.teamVotes.set(player.id, vote);
    finalizeVote(room);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "mission-card") {
    if (room.stage !== "mission" || !room.proposal) return fail(res, 409, "当前不能提交任务牌");
    if (!room.proposal.teamIds.includes(player.id)) return fail(res, 403, "只有上队玩家可以提交任务牌");
    if (room.missionCards.has(player.id)) return fail(res, 409, "你已经提交过任务牌");
    const assignment = room.assignments.get(player.id);
    const role = assignment ? ROLE_LIBRARY[assignment.roleId] : null;
    const card = body.card === "fail" ? "fail" : body.card === "success" ? "success" : null;
    if (!card) return fail(res, 400, "任务牌参数不正确");
    if (card === "fail" && role?.team !== "evil") return fail(res, 403, "好人阵营不能提交失败牌");
    room.missionCards.set(player.id, card);
    finalizeMission(room);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "assassinate") {
    if (room.stage !== "assassination" || !room.assassination) return fail(res, 409, "当前不能刺杀");
    if (player.id !== room.assassination.assassinId) return fail(res, 403, "只有刺客可以选择刺杀目标");
    if (room.assassination.targetId) return fail(res, 409, "刺杀已经完成");
    const targetId = String(body.targetId || "");
    const target = room.players.find((item) => item.id === targetId);
    if (!target) return fail(res, 400, "目标玩家不存在");
    if (targetId === player.id) return fail(res, 400, "刺客不能选择自己");
    room.assassination.targetId = targetId;
    room.assassination.targetName = target.name;
    room.assassination.targetAvatar = target.avatar;
    room.assassination.hit = targetId === room.assassination.merlinId;
    room.stage = "finished";
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  if (req.method === "POST" && action === "reset") {
    requireHost(room, player);
    room.stage = "lobby";
    room.assignments.clear();
    room.leaderIndex = 0;
    room.missionResults = [];
    room.lastVote = null;
    room.lastMission = null;
    room.assassination = null;
    room.forceEnded = null;
    clearRoundInputs(room);
    json(res, 200, { ok: true });
    broadcast(room);
    return;
  }

  fail(res, 404, "接口不存在");
}

function handleEvents(req, res, url, code) {
  const room = getRoom(code);
  const params = {
    playerId: url.searchParams.get("playerId"),
    secret: url.searchParams.get("secret"),
  };
  const player = requirePlayer(room, params);

  res.writeHead(200, {
    ...corsHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    }),
  });

  const client = { res, playerId: player.id };
  room.clients.add(client);
  sendEvent(client, "snapshot", buildSnapshot(room, player.id));
  broadcast(room);

  const heartbeat = setInterval(() => {
    try {
      sendEvent(client, "ping", { now: Date.now() });
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    room.clients.delete(client);
    if (rooms.has(room.code)) broadcast(room);
  });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    fail(res, 403, "禁止访问");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fail(res, 404, "文件不存在");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/env.js") {
      serveEnv(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/events/")) {
      handleEvents(req, res, url, url.pathname.split("/")[2]);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/rooms/") && url.pathname.endsWith("/snapshot")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const room = getRoom(parts[2]);
      const player = requirePlayer(room, {
        playerId: url.searchParams.get("playerId"),
        secret: url.searchParams.get("secret"),
      });
      json(res, 200, buildSnapshot(room, player.id));
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(req, res, url);
  } catch (error) {
    fail(res, error.status || 500, error.message || "服务器错误");
  }
});

server.listen(port, host, () => {
  console.log(`Avalon online prototype running at http://127.0.0.1:${port}`);
});
