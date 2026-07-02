const SESSION_KEY = "avalon-online-session-v1";
const runtimeEnv = window.__AVALON_ENV__ || {};
const API_ORIGIN = normalizeOrigin(runtimeEnv.VITE_API_URL || "");
const SOCKET_ORIGIN = normalizeOrigin(runtimeEnv.VITE_SOCKET_URL || runtimeEnv.VITE_API_URL || "");

function normalizeOrigin(value) {
  return String(value || "").replace(/\/$/, "");
}

function apiUrl(path) {
  return API_ORIGIN ? `${API_ORIGIN}${path}` : path;
}

function socketUrl(path) {
  return SOCKET_ORIGIN ? `${SOCKET_ORIGIN}${path}` : path;
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

const els = {
  homeView: document.querySelector("#homeView"),
  roomView: document.querySelector("#roomView"),
  createForm: document.querySelector("#createForm"),
  joinForm: document.querySelector("#joinForm"),
  createName: document.querySelector("#createName"),
  createAvatar: document.querySelector("#createAvatar"),
  joinCode: document.querySelector("#joinCode"),
  joinName: document.querySelector("#joinName"),
  joinAvatar: document.querySelector("#joinAvatar"),
  roomTitle: document.querySelector("#roomTitle"),
  copyInvite: document.querySelector("#copyInvite"),
  leaveRoom: document.querySelector("#leaveRoom"),
  stageTitle: document.querySelector("#stageTitle"),
  stageTip: document.querySelector("#stageTip"),
  playerCount: document.querySelector("#playerCount"),
  roleCount: document.querySelector("#roleCount"),
  roundCount: document.querySelector("#roundCount"),
  leaderPill: document.querySelector("#leaderPill"),
  playersList: document.querySelector("#playersList"),
  selfPill: document.querySelector("#selfPill"),
  identityBox: document.querySelector("#identityBox"),
  setupWarning: document.querySelector("#setupWarning"),
  rolesList: document.querySelector("#rolesList"),
  dealButton: document.querySelector("#dealButton"),
  missionTrack: document.querySelector("#missionTrack"),
  playBox: document.querySelector("#playBox"),
  teamSizePill: document.querySelector("#teamSizePill"),
  toast: document.querySelector("#toast"),
};

let session = loadSession();
let snapshot = null;
let events = null;
let selectedTeam = new Set();
let selectionKey = "";

const stageText = {
  lobby: {
    title: "等待开局",
    tip: "房主配置身份，玩家用房间号或邀请链接加入。身份数量必须等于已加入玩家数。",
  },
  proposal: {
    title: "队长提名",
    tip: "当前队长在自己的设备上选择任务队伍。房主不能代替队长提名。",
  },
  voting: {
    title: "组队投票",
    tip: "每位玩家在自己的设备上选择赞成或反对。系统只公布总票数，不公布个人选择。",
  },
  mission: {
    title: "提交任务牌",
    tip: "只有上队玩家能提交任务牌。好人只能成功，坏人可以成功或失败，最后只公布牌数汇总。",
  },
  assassination: {
    title: "刺杀梅林",
    tip: "好人完成三次任务。现在由刺客在自己的设备上选择梅林；命中则坏人逆转，未命中则好人获胜。",
  },
  finished: {
    title: "对局结束",
    tip: "身份和任务记录已经公开，可以开始复盘。",
  },
};

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
}

function clearSession() {
  session = null;
  snapshot = null;
  selectedTeam.clear();
  localStorage.removeItem(SESSION_KEY);
  if (events) events.close();
  events = null;
}

function icon(id) {
  return `<svg><use href="#${id}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function avatarHtml(avatar, className = "avatar") {
  const value = String(avatar || "🎲").trim() || "🎲";
  if (/^https?:\/\//i.test(value)) {
    return `<span class="${className} image-avatar"><img src="${escapeHtml(value)}" alt="" /></span>`;
  }
  return `<span class="${className}">${escapeHtml(value)}</span>`;
}

function playerLabel(id) {
  const player = snapshot?.players.find((item) => item.id === id);
  if (!player) return "";
  return `${player.avatar || "🎲"} ${player.name}`;
}

function playerChips(ids) {
  return ids
    .map((id) => {
      const player = snapshot?.players.find((item) => item.id === id);
      if (!player) return "";
      return `<span class="player-chip">${avatarHtml(player.avatar, "chip-avatar")}${escapeHtml(player.name)}</span>`;
    })
    .join("");
}

function missionCards(mission) {
  return mission?.cards?.length ? mission.cards.join(" ") : "";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
}

async function post(path, body) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function authed(extra = {}) {
  return {
    playerId: session.playerId,
    secret: session.secret,
    ...extra,
  };
}

async function connect() {
  if (!session?.roomCode || !session?.playerId || !session?.secret) {
    renderHome();
    return;
  }

  renderRoomShell();
  if (events) events.close();
  const params = new URLSearchParams({
    playerId: session.playerId,
    secret: session.secret,
  });
  try {
    const response = await fetch(apiUrl(`/api/rooms/${encodeURIComponent(session.roomCode)}/snapshot?${params}`));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "房间已失效");
    snapshot = data;
    renderRoom();
  } catch (error) {
    clearSession();
    renderHome();
    showToast("旧房间已失效，请重新创建或加入");
    return;
  }

  events = new EventSource(socketUrl(`/events/${encodeURIComponent(session.roomCode)}?${params}`));
  events.addEventListener("snapshot", (event) => {
    const next = JSON.parse(event.data);
    const nextKey = `${next.stage}:${next.roundIndex}:${next.leaderId || ""}`;
    if (nextKey !== selectionKey && next.stage === "proposal") {
      selectedTeam.clear();
    }
    selectionKey = nextKey;
    snapshot = next;
    renderRoom();
  });
  events.addEventListener("removed", (event) => {
    const data = JSON.parse(event.data || "{}");
    clearSession();
    history.replaceState(null, "", "/");
    renderHome();
    showToast(data.reason || "你已离开房间");
  });
  events.onerror = () => {
    showToast("连接断开，正在尝试重连");
  };
}

function renderHome() {
  els.homeView.classList.remove("is-hidden");
  els.roomView.classList.add("is-hidden");
}

function renderRoomShell() {
  els.homeView.classList.add("is-hidden");
  els.roomView.classList.remove("is-hidden");
  els.stageTitle.textContent = "连接中";
  els.stageTip.textContent = "正在进入房间。";
}

function renderRoom() {
  if (!snapshot) return;
  els.homeView.classList.add("is-hidden");
  els.roomView.classList.remove("is-hidden");
  els.roomTitle.textContent = `房间 ${snapshot.code}`;

  const stage = stageText[snapshot.stage] || stageText.lobby;
  els.stageTitle.textContent = stage.title;
  els.stageTip.textContent = stage.tip;
  els.playerCount.textContent = snapshot.playerTotal;
  els.roleCount.textContent = snapshot.roleTotal;
  els.roundCount.textContent = snapshot.roundIndex;
  els.teamSizePill.textContent = snapshot.stage === "finished" ? "已结束" : snapshot.stage === "assassination" ? "刺杀" : `需 ${snapshot.currentTeamSize} 人`;
  els.leaderPill.textContent = `队长：${playerName(snapshot.leaderId) || "未定"}`;
  els.leaveRoom.disabled = !snapshot.canManageRoster;
  els.leaveRoom.title = snapshot.canManageRoster ? "离开房间" : "游戏进行中不能退出";

  renderPlayers();
  renderIdentity();
  renderSetup();
  renderMissionTrack();
  renderPlay();
}

function playerName(id) {
  return snapshot?.players.find((player) => player.id === id)?.name || "";
}

function isMinimalMode() {
  if (!snapshot) return false;
  const active = snapshot.roles.filter((role) => role.count > 0);
  return active.length > 0 && active.every((role) => ["servant", "minion"].includes(role.id));
}

function renderPlayers() {
  const canKick = snapshot.self.isHost && snapshot.canManageRoster;
  els.playersList.innerHTML = snapshot.players
    .map(
      (player, index) => `
        <div class="player-row ${player.id === snapshot.self.id ? "is-self" : ""}">
          ${avatarHtml(player.avatar)}
          <div class="player-meta">
            <strong>${escapeHtml(player.name)}</strong>
            <span>${[
              `${index + 1} 号位`,
              player.isHost ? "房主" : "",
              player.isLeader ? "队长" : "",
            ]
              .filter(Boolean)
              .join(" · ") || "玩家"}</span>
          </div>
          ${
            player.id === snapshot.self.id
              ? `<span class="self-badge">你本人</span>`
              : canKick
                ? `<button class="kick-button" data-kick="${player.id}" title="移出玩家">移出</button>`
                : `<span class="online-dot ${player.connected ? "is-online" : ""}" title="${player.connected ? "在线" : "离线"}"></span>`
          }
        </div>
      `
    )
    .join("");
}

function renderIdentity() {
  const role = snapshot.self.role;
  if (!role) {
    els.selfPill.textContent = "未发牌";
    els.identityBox.className = "identity-empty";
    els.identityBox.innerHTML = "<p>房主发牌后，这里只会显示你的身份和你应该知道的信息。</p>";
    return;
  }

  els.selfPill.textContent = `${role.emoji || "🎭"} ${role.team === "good" ? "好人阵营" : "坏人阵营"}`;
  els.identityBox.className = `identity-card ${role.team}`;
  els.identityBox.innerHTML = `
    <span class="badge ${role.team}">${role.team === "good" ? "好人" : "坏人"}</span>
    <h3><span>${escapeHtml(role.emoji || "🎭")}</span>${escapeHtml(role.name)}</h3>
    <p>${escapeHtml(role.intro)}</p>
    <div class="knowledge-list">
      ${snapshot.self.knowledge
        .map((item) => `<div><strong>${escapeHtml(item.label)}</strong><br />${escapeHtml(item.value)}</div>`)
        .join("")}
    </div>
  `;
}

function renderSetup() {
  const isHost = snapshot.self.isHost;
  const locked = snapshot.stage !== "lobby";
  const warning = snapshot.configValid
    ? locked
      ? "身份配置已锁定。房主可重置回大厅重新配置。"
      : ""
    : `当前 ${snapshot.playerTotal} 名玩家，身份数为 ${snapshot.roleTotal}，需要二者相等且人数在 5-10 之间。`;
  els.setupWarning.textContent = isHost ? warning : locked ? "对局已开始，身份池仅供查看。" : "等待房主配置身份并发牌。";
  els.dealButton.disabled = !isHost || locked || !snapshot.configValid;
  els.dealButton.innerHTML = locked ? "对局进行中" : `${icon("shuffle")}随机发牌并开始`;

  const minimalGuide = isMinimalMode()
    ? `<div class="tutorial-card">
        <strong>第一局极简教程</strong>
        <p>这个模式只有忠臣和爪牙，没有梅林视野和刺杀压力。它适合先练三件事：队长怎么组队、所有人怎么投组队票、上队玩家怎么偷偷交 ✅ 或 ❌。</p>
      </div>`
    : "";

  els.rolesList.innerHTML = minimalGuide + snapshot.roles
    .map(
      (role) => `
        <article class="role-row">
          <div>
            <div class="role-title">
              <strong>${escapeHtml(role.emoji || "🎭")} ${escapeHtml(role.name)}</strong>
              <span class="badge ${role.team}">${role.team === "good" ? "好人" : "坏人"}</span>
            </div>
            <p>${escapeHtml(role.intro)}</p>
          </div>
          <div class="role-controls">
            <button class="icon-button" data-role="${role.id}" data-delta="-1" ${!isHost || locked ? "disabled" : ""} aria-label="减少${escapeHtml(role.name)}">${icon("minus")}</button>
            <span>${role.count}</span>
            <button class="icon-button" data-role="${role.id}" data-delta="1" ${!isHost || locked ? "disabled" : ""} aria-label="增加${escapeHtml(role.name)}">${icon("plus")}</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderMissionTrack() {
  els.missionTrack.innerHTML = Array.from({ length: 5 }, (_, index) => {
    const mission = snapshot.missionResults[index];
    const size = snapshot.questSizes[index];
    const threshold = snapshot.playerTotal >= 7 && index === 3 ? 2 : 1;
    const className = mission?.result || (!mission && index === snapshot.roundIndex && snapshot.stage !== "finished" ? "is-current" : "");
    const label = mission ? (mission.result === "success" ? "✅ 成功" : "❌ 失败") : `需 ${size} 人`;
    const detail = mission ? missionCards(mission) : threshold > 1 ? "特殊轮：2 张失败才失败" : "1 张失败即失败";
    return `
      <article class="mission-card ${className}">
        <strong>${index + 1}</strong>
        <span>${label}</span>
        <span>${detail}</span>
      </article>
    `;
  }).join("");
}

function renderPlay() {
  if (snapshot.stage === "lobby") {
    renderLobbyPlay();
    return;
  }
  if (snapshot.stage === "proposal") {
    renderProposal();
    return;
  }
  if (snapshot.stage === "voting") {
    renderVoting();
    return;
  }
  if (snapshot.stage === "mission") {
    renderMission();
    return;
  }
  if (snapshot.stage === "assassination") {
    renderAssassination();
    return;
  }
  renderFinished();
}

function renderLobbyPlay() {
  els.playBox.innerHTML = `
    <h3>开局前</h3>
    <p>把房间号发给朋友，等所有人加入后由房主发牌。发牌后每个人只会在自己的设备上看到自己的身份。</p>
    ${
      isMinimalMode()
        ? "<p>当前是极简教学局：忠臣负责找队伍，爪牙负责藏住自己并在任务里捣乱。先别管复杂角色，把节奏玩顺最重要。</p>"
        : ""
    }
    <p>特殊轮提醒：7 人及以上的第 4 轮通常需要 2 张 ❌ 才算任务失败。</p>
    <div class="action-row">
      <button class="secondary" data-copy-code>${icon("copy")}复制房间号</button>
      <button class="secondary" data-copy-invite>${icon("copy")}复制邀请链接</button>
    </div>
  `;
}

function renderProposal() {
  const canPropose = snapshot.self.isLeader;
  const previous = snapshot.lastVote
    ? `<p>上一轮组队投票：赞成 ${snapshot.lastVote.approve}，反对 ${snapshot.lastVote.reject}，${snapshot.lastVote.approved ? "已通过" : "未通过"}。</p>`
    : "";
  const lastMission = snapshot.lastMission
    ? `<p>上一轮任务：第 ${snapshot.lastMission.roundIndex + 1} 轮：<strong>${missionCards(snapshot.lastMission)}</strong>，${snapshot.lastMission.result === "success" ? "任务成功" : "任务失败"}。</p>`
    : "";

  if (!canPropose) {
    els.playBox.innerHTML = `
      <h3>等待队长提名</h3>
      ${lastMission}
      ${previous}
      <p>当前队长是 <strong>${escapeHtml(playerName(snapshot.leaderId))}</strong>。队伍确定后，你会在这里投赞成或反对。</p>
    `;
    return;
  }

  els.playBox.innerHTML = `
    <h3>提名任务队伍</h3>
    ${lastMission}
    ${previous}
    <p>本轮任务需要选择 <strong>${snapshot.currentTeamSize}</strong> 人。</p>
    <div class="team-grid">
      ${snapshot.players
        .map((player) => {
          const checked = selectedTeam.has(player.id);
          return `
            <label class="team-option ${checked ? "is-picked" : ""} ${player.id === snapshot.self.id ? "is-self" : ""}">
              <input type="checkbox" data-team-id="${player.id}" ${checked ? "checked" : ""} />
              ${avatarHtml(player.avatar, "mini-avatar")}
              <span>${escapeHtml(player.name)}</span>
              ${player.id === snapshot.self.id ? `<strong class="self-mini">你</strong>` : ""}
            </label>
          `;
        })
        .join("")}
    </div>
    <button class="primary" id="submitProposal" ${selectedTeam.size !== snapshot.currentTeamSize ? "disabled" : ""}>
      ${icon("flag")}提交队伍
    </button>
  `;
}

function renderVoting() {
  const teamNames = playerChips(snapshot.proposal.teamIds);
  const hasVoted = Boolean(snapshot.self.vote);
  els.playBox.innerHTML = `
    <h3>组队投票</h3>
    <div class="inline-team"><span>提名队伍：</span>${teamNames}</div>
    ${
      hasVoted
        ? `<p>你已投票：<strong>${snapshot.self.vote === "approve" ? "赞成" : "反对"}</strong>。等待其他玩家提交。</p>`
        : `<div class="vote-buttons">
            <button class="approve" data-vote="approve">${icon("check")}赞成</button>
            <button class="reject" data-vote="reject">${icon("x")}反对</button>
          </div>`
    }
    ${renderVoteStatus()}
  `;
}

function renderVoteStatus() {
  const rows = snapshot.voteStatus
    .map((item) => {
      const player = snapshot.players.find((entry) => entry.id === item.playerId);
      return `<div class="status-row"><strong>${avatarHtml(player?.avatar, "mini-avatar")}${escapeHtml(player?.name || "")}</strong><span>${item.submitted ? "已提交" : "等待"}</span></div>`;
    })
    .join("");
  return `<div class="status-list">${rows}</div>`;
}

function renderMission() {
  const teamNames = playerChips(snapshot.proposal.teamIds);
  if (!snapshot.self.isOnTeam) {
    els.playBox.innerHTML = `
      <h3>等待任务牌</h3>
      <div class="inline-team"><span>本轮上队玩家：</span>${teamNames}</div>
      <p>你不在队伍中，等待他们提交任务牌。</p>
      ${renderMissionStatus()}
    `;
    return;
  }

  if (snapshot.self.missionSubmitted) {
    els.playBox.innerHTML = `
      <h3>任务牌已提交</h3>
      <div class="inline-team"><span>本轮上队玩家：</span>${teamNames}</div>
      <p>等待其他上队玩家提交。系统只会公布成功牌和失败牌数量，不会公布谁出了什么。</p>
      ${renderMissionStatus()}
    `;
    return;
  }

  els.playBox.innerHTML = `
    <h3>提交任务牌</h3>
    <div class="inline-team"><span>本轮上队玩家：</span>${teamNames}</div>
    <p>${snapshot.self.canPlayFail ? "你可以选择成功或失败。" : "好人阵营只能提交成功牌。"}</p>
    <div class="vote-buttons">
      <button class="success-card" data-card="success">${icon("check")}成功</button>
      <button class="fail-card" data-card="fail" ${snapshot.self.canPlayFail ? "" : "disabled"}>${icon("x")}失败</button>
    </div>
    ${renderMissionStatus()}
  `;
}

function renderMissionStatus() {
  const rows = snapshot.missionStatus
    .map((item) => {
      const player = snapshot.players.find((entry) => entry.id === item.playerId);
      return `<div class="status-row"><strong>${avatarHtml(player?.avatar, "mini-avatar")}${escapeHtml(player?.name || "")}</strong><span>${item.submitted ? "已提交" : "等待"}</span></div>`;
    })
    .join("");
  return `<div class="status-list">${rows}</div>`;
}

function renderAssassination() {
  const last = snapshot.lastMission
    ? `<p>第三次成功任务：第 ${snapshot.lastMission.roundIndex + 1} 轮：<strong>${missionCards(snapshot.lastMission)}</strong>。</p>`
    : "";

  if (!snapshot.self.canAssassinate) {
    els.playBox.innerHTML = `
      <h3>等待刺杀</h3>
      ${last}
      <p>好人已经完成三次任务。刺客正在自己的设备上选择梅林，选择完成后会公开身份和完整复盘。</p>
    `;
    return;
  }

  els.playBox.innerHTML = `
    <h3>刺杀梅林</h3>
    ${last}
    <p>你是刺客。请选择你认为的梅林，命中则坏人阵营逆转获胜。</p>
    <div class="target-grid">
      ${snapshot.players
        .filter((player) => player.id !== snapshot.self.id)
        .map(
          (player) => `
            <button class="target-card" data-assassinate="${player.id}">
              ${avatarHtml(player.avatar)}
              <span>${escapeHtml(player.name)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderMissionHistory() {
  if (!snapshot.missionResults.length) return "<p>还没有任务记录。</p>";
  return `
    <div class="history-list">
      ${snapshot.missionResults
        .map((mission) => {
          const isSpecial = snapshot.playerTotal >= 7 && mission.roundIndex === 3;
          const choiceRows = mission.choices?.length
            ? `<div class="choice-list">
                ${mission.choices
                  .map((choice) => {
                    const player = snapshot.players.find((entry) => entry.id === choice.playerId);
                    return `<div class="choice-row ${choice.card}">
                      ${avatarHtml(player?.avatar || choice.avatar, "mini-avatar")}
                      <span>${escapeHtml(player?.name || choice.name || "离场玩家")}</span>
                      <strong>${choice.symbol}</strong>
                    </div>`;
                  })
                  .join("")}
              </div>`
            : `<div class="inline-team">${playerChips(mission.teamIds)}</div>`;
          return `
            <article class="history-row ${mission.result}">
              <div>
                <strong>第 ${mission.roundIndex + 1} 轮：${mission.cards.join(" ")}</strong>
                <span>${mission.result === "success" ? "任务成功" : "任务失败"} · ${isSpecial ? "特殊轮 · " : ""}失败阈值 ${mission.threshold} 张</span>
              </div>
              ${choiceRows}
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderRevealedRoles() {
  if (!snapshot.revealedRoles?.length) return "";
  return `
    <div class="reveal-grid">
      ${snapshot.revealedRoles
        .map(
          (entry) => `
            <article class="reveal-card ${entry.role?.team || ""}">
              ${avatarHtml(entry.avatar)}
              <div>
                <strong>${escapeHtml(entry.name)}</strong>
                <span>${escapeHtml(entry.role?.emoji || "🎭")} ${escapeHtml(entry.role?.name || "未知身份")}</span>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderFinished() {
  const winner = snapshot.winner === "good" ? "好人阵营" : "坏人阵营";
  const last = snapshot.lastMission
    ? `<p>最后一次任务：第 ${snapshot.lastMission.roundIndex + 1} 轮：<strong>${missionCards(snapshot.lastMission)}</strong>，${snapshot.lastMission.result === "success" ? "任务成功" : "任务失败"}。</p>`
    : "";
  const assassinationTarget = snapshot.assassination?.targetId
    ? playerChips([snapshot.assassination.targetId]) ||
      `<span class="player-chip">${avatarHtml(snapshot.assassination.targetAvatar, "chip-avatar")}${escapeHtml(snapshot.assassination.targetName || "离场玩家")}</span>`
    : "";
  const assassination = snapshot.assassination?.targetId
    ? `<div class="assassination-result ${snapshot.assassination.hit ? "hit" : "miss"}">
        <strong>${snapshot.assassination.hit ? "刺杀命中梅林" : "刺杀未命中"}</strong>
        <span>刺杀目标：${assassinationTarget}</span>
      </div>`
    : "";
  els.playBox.innerHTML = `
    <h3>${winner}获胜</h3>
    ${last}
    ${assassination}
    <p>${snapshot.winner === "good" ? "梅林没有被刺中，好人守住胜利。" : snapshot.assassination?.hit ? "刺客找到了梅林，坏人逆转成功。" : "坏人已经让三次任务失败。"}</p>
    <h3>公开身份</h3>
    ${renderRevealedRoles()}
    <h3>任务记录</h3>
    ${renderMissionHistory()}
    ${snapshot.self.isHost ? `<button class="secondary" id="resetRoom">重置回大厅</button>` : ""}
  `;
}

async function createRoom(event) {
  event.preventDefault();
  try {
    const data = await post("/api/rooms", { name: els.createName.value, avatar: els.createAvatar.value });
    saveSession(data);
    history.replaceState(null, "", `/?room=${data.roomCode}`);
    connect();
  } catch (error) {
    showToast(error.message);
  }
}

async function joinRoom(event) {
  event.preventDefault();
  const code = els.joinCode.value.trim().toUpperCase();
  if (!code) {
    showToast("请输入房间号");
    return;
  }
  try {
    const data = await post(`/api/rooms/${encodeURIComponent(code)}/join`, { name: els.joinName.value, avatar: els.joinAvatar.value });
    saveSession(data);
    history.replaceState(null, "", `/?room=${data.roomCode}`);
    connect();
  } catch (error) {
    showToast(error.message);
  }
}

async function copyInvite() {
  if (!snapshot) return;
  const publicOrigin = `${location.origin}/?room=${snapshot.code}`;
  const text = isLocalHost(location.hostname) && snapshot.inviteUrl ? snapshot.inviteUrl : publicOrigin;
  await navigator.clipboard?.writeText(text);
  showToast("邀请链接已复制");
}

async function copyCode() {
  if (!snapshot) return;
  await navigator.clipboard?.writeText(snapshot.code);
  showToast("房间号已复制");
}

async function sendRoomAction(action, body = {}) {
  return post(`/api/rooms/${encodeURIComponent(session.roomCode)}/${action}`, authed(body));
}

els.createForm.addEventListener("submit", createRoom);
els.joinForm.addEventListener("submit", joinRoom);
els.copyInvite.addEventListener("click", copyInvite);
els.leaveRoom.addEventListener("click", async () => {
  if (!session) return;
  if (snapshot && !snapshot.canManageRoster) {
    showToast("游戏进行中不能退出");
    return;
  }
  try {
    await sendRoomAction("leave");
  } catch (error) {
    showToast(error.message);
    return;
  }
  clearSession();
  history.replaceState(null, "", "/");
  renderHome();
});
els.dealButton.addEventListener("click", async () => {
  try {
    await sendRoomAction("deal");
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const avatarButton = event.target.closest("[data-avatar]");
  const roleButton = event.target.closest("[data-role]");
  const presetButton = event.target.closest("[data-preset]");
  const voteButton = event.target.closest("[data-vote]");
  const cardButton = event.target.closest("[data-card]");
  const assassinateButton = event.target.closest("[data-assassinate]");
  const kickButton = event.target.closest("[data-kick]");
  const proposalButton = event.target.closest("#submitProposal");
  const resetButton = event.target.closest("#resetRoom");

  try {
    if (avatarButton) {
      const picker = avatarButton.closest("[data-avatar-picker]");
      const input = picker ? document.querySelector(`#${picker.dataset.avatarPicker}`) : null;
      if (input) input.value = avatarButton.dataset.avatar;
      return;
    }
    if (roleButton) {
      await sendRoomAction("role", {
        roleId: roleButton.dataset.role,
        delta: Number(roleButton.dataset.delta),
      });
    }
    if (presetButton) {
      await sendRoomAction("preset", { preset: presetButton.dataset.preset });
    }
    if (voteButton) {
      await sendRoomAction("vote", { vote: voteButton.dataset.vote });
    }
    if (cardButton) {
      await sendRoomAction("mission-card", { card: cardButton.dataset.card });
    }
    if (assassinateButton) {
      await sendRoomAction("assassinate", { targetId: assassinateButton.dataset.assassinate });
    }
    if (kickButton) {
      await sendRoomAction("kick", { targetId: kickButton.dataset.kick });
    }
    if (proposalButton) {
      await sendRoomAction("propose", { teamIds: [...selectedTeam] });
    }
    if (resetButton) {
      await sendRoomAction("reset");
    }
    if (event.target.closest("[data-copy-code]")) {
      await copyCode();
    }
    if (event.target.closest("[data-copy-invite]")) {
      await copyInvite();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-team-id]");
  if (!checkbox || !snapshot) return;
  const playerId = checkbox.dataset.teamId;
  if (checkbox.checked) {
    if (selectedTeam.size >= snapshot.currentTeamSize) {
      checkbox.checked = false;
      showToast(`本轮只能选 ${snapshot.currentTeamSize} 人`);
      return;
    }
    selectedTeam.add(playerId);
  } else {
    selectedTeam.delete(playerId);
  }
  renderPlay();
});

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  const normalizedRoom = urlRoom.toUpperCase();
  els.joinCode.value = normalizedRoom;
  if (session?.roomCode && session.roomCode !== normalizedRoom) {
    clearSession();
  }
}

if (session) {
  connect();
} else {
  renderHome();
}
