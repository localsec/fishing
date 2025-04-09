import blessed from "blessed";
import figlet from "figlet";
import fs from "fs";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import fetch from "node-fetch";

let currentEnergy = 0;
const tokens = fs.readFileSync("token.txt", "utf8")
  .split("\n")
  .map(line => line.trim())
  .filter(line => line !== "");
let activeToken = tokens.length > 0 ? tokens[0] : "";
let activeProxy = null;

function getShortAddress(address) {
  if (!address || address.length < 10) return address;
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function getRequestHeaders() {
  return {
    'accept': 'application/json',
    'authorization': `Bearer ${activeToken}`,
    'content-type': 'application/json',
    'sec-ch-ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Brave";v="134"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'Referer': 'https://fishingfrenzy.co/',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  };
}

function getAgent() {
  if (activeProxy) {
    return new HttpsProxyAgent(activeProxy);
  }
  return null;
}

async function getExternalIP() {
  try {
    const agent = getAgent();
    const options = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
    if (agent) options.agent = agent;
    const response = await fetch("https://api.ipify.org?format=json", options);
    if (!response.ok) throw new Error(`Lỗi HTTP! trạng thái: ${response.status}`);
    const data = await response.json();
    return data.ip;
  } catch (err) {
    return "Không khả dụng";
  }
}

const screen = blessed.screen({
  smartCSR: true,
  title: "LocalSec",
  fullUnicode: true,
  mouse: true,
});

let headerContentHeight = 0;
let autoTaskRunning = false;
let autoFishingRunning = false;
let autoDailyRunning = false;
let autoProcessCancelled = false;
let accountPromptActive = false;

const normalMenuItems = [
  "Tự động hoàn thành nhiệm vụ",
  "Tự động câu cá",
  "Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ",
  "Thay đổi tài khoản",
  "Xóa nhật ký",
  "Làm mới",
  "Thoát"
];

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  height: 5, 
  tags: true,
  style: { fg: "white" }
});

figlet.text("LocalSec", { font: "Speed" }, (err, data) => {
  let asciiBanner = "";
  if (!err) {
    asciiBanner = `{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`;
  } else {
    asciiBanner = "{center}{bold}{bright-cyan-fg}LocalSec{/bright-cyan-fg}{/bold}{/center}";
  }

  const descriptionText = "{center}{bold}{bright-yellow-fg}✦ . ── Đừng câu cá nữa, câu em Vân đi!!! ── .✦{/bright-yellow-fg}{/bold}{/center}";
  headerBox.setContent(`${asciiBanner}\n${descriptionText}`);

  const totalLines = headerBox.getContent().split("\n").length;
  headerContentHeight = totalLines + 1; 
  adjustLayout();
  screen.render();
});

screen.append(headerBox);

const logsBox = blessed.box({
  label: " Nhật ký ",
  top: 0,
  left: 0,
  width: "60%",
  height: "100%",
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  style: { border: { fg: "red" }, fg: "white" }
});

const userInfoBox = blessed.box({
  label: " Thông tin người dùng ",
  top: 0,
  left: "60%",
  width: "40%",
  height: 12,
  border: { type: "line" },
  tags: true,
  style: { border: { fg: "cyan" }, fg: "white" },
  content:
    "Tên người dùng: đang tải...\n" +
    "Ví: đang tải...\n" +
    "Cấp độ: đang tải...\n" +
    "Vàng: đang tải...\n" +
    "Năng lượng: đang tải...\n" +
    "EXP: đang tải...\n" +
    "IP: đang tải..."
});

const mainMenu = blessed.list({
  label: " Thực đơn ",
  top: 0,
  left: "60%",
  width: "40%",
  height: "100%",
  keys: true,
  mouse: true,
  vi: true,
  border: { type: "line" },
  tags: true,
  style: {
    item: { fg: "white" },
    selected: { bg: "green", fg: "black" },
    border: { fg: "yellow" }
  },
  items: normalMenuItems
});

const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: "20%",
  width: "50%",
  top: "center",
  left: "center",
  label: " Số lần câu cá ",
  tags: true,
  keys: true,
  mouse: true,
  style: { fg: "white", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(logsBox);
screen.append(userInfoBox);
screen.append(mainMenu);

function safeRender() {
  setTimeout(() => screen.render(), 50);
}

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logsBox.pushLine(`${timestamp} - ${message}`);
  logsBox.setScrollPerc(100);
  safeRender();
}

function clearLogs() {
  logsBox.setContent("");
  logsBox.setScroll(0);
  safeRender();
  addLog("{bright-yellow-fg}Nhật ký đã được xóa.{/bright-yellow-fg}");
}

async function updateUserInfo() {
  try {
    const agent = getAgent();
    const options = { headers: getRequestHeaders() };
    if (agent) options.agent = agent;
    const response = await fetch("https://api.fishingfrenzy.co/v1/users/me", options);
    if (!response.ok) throw new Error(`Lỗi HTTP! trạng thái: ${response.status}`);
    const data = await response.json();
    currentEnergy = data && data.energy !== undefined ? data.energy : 0;
    let ipLine = "";
    if (activeProxy) {
      const proxyIP = await getExternalIP();
      ipLine = `IP: ${proxyIP}`;
    } else {
      const externalIP = await getExternalIP();
      ipLine = `IP: ${externalIP}`;
    }
    const content = `Tên người dùng: ${data.username}
Ví: ${getShortAddress(data.walletAddress)}
Cấp độ: ${data.level}
Vàng: ${data.gold}
Năng lượng: ${data.energy}
EXP: ${data.exp !== undefined ? data.exp : "N/A"}
${ipLine}`;
    userInfoBox.setContent(content);
    safeRender();
    addLog("{bright-yellow-fg}Thông tin người dùng đã được cập nhật.{/bright-yellow-fg}");
  } catch (err) {
    addLog(`{red-fg}Lỗi khi lấy thông tin người dùng: ${err.message}{/red-fg}`);
  }
}

function updateMenuItems() {
  if (autoTaskRunning || autoFishingRunning || autoDailyRunning) {
    mainMenu.setItems([
      "{gray-fg}Tự động hoàn thành nhiệm vụ{/gray-fg}",
      "{gray-fg}Tự động câu cá{/gray-fg}",
      "{gray-fg}Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ{/gray-fg}",
      "{gray-fg}Thay đổi tài khoản{/gray-fg}",
      "Xóa nhật ký",
      "Dừng tiến trình",
      "Làm mới",
      "Thoát"
    ]);
  } else {
    mainMenu.setItems([
      "Tự động hoàn thành nhiệm vụ",
      "Tự động câu cá",
      "Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ",
      "Thay đổi tài khoản",
      "Xóa nhật ký",
      "Làm mới",
      "Thoát"
    ]);
  }
  mainMenu.select(0);
  safeRender();
}

async function autoCompleteTask() {
  try {
    autoTaskRunning = true;
    autoProcessCancelled = false;
    updateMenuItems();
    addLog("{bright-yellow-fg}Bắt đầu Tự động hoàn thành nhiệm vụ...{/bright-yellow-fg}");
    const agent = getAgent();
    const options = { headers: getRequestHeaders() };
    if (agent) options.agent = agent;
    const tasksResponse = await fetch("https://api.fishingfrenzy.co/v1/social-quests/", options);
    if (!tasksResponse.ok)
      throw new Error(`Lỗi HTTP khi lấy nhiệm vụ! trạng thái: ${tasksResponse.status}`);
    const tasks = await tasksResponse.json();
    addLog(`{blue-fg}Đã lấy được ${tasks.length} nhiệm vụ.{/blue-fg}`);
    for (const task of tasks) {
      if (autoProcessCancelled) {
        addLog("{yellow-fg}Quy trình Tự động hoàn thành nhiệm vụ đã bị hủy.{/yellow-fg}");
        break;
      }
      if (task.status === "UnClaimed") {
        addLog(`{yellow-fg}Đang hoàn thành nhiệm vụ: ${task.description}{/yellow-fg}`);
        const postUrl = `https://api.fishingfrenzy.co/v1/social-quests/${task.id}/verify`;
        const postResponse = await fetch(postUrl, { method: "POST", headers: getRequestHeaders() });
        if (!postResponse.ok) {
          addLog(`{bright-red-fg}Lỗi xác minh nhiệm vụ ${task.description}: HTTP ${postResponse.status}{/bright-red-fg}`);
          continue;
        }
        const result = await postResponse.json();
        if (result && Array.isArray(result.socialQuests)) {
          const updatedTask = result.socialQuests.find((t) => t.id === task.id);
          if (updatedTask) {
            const goldReward = updatedTask.rewards.find((r) => r.type === "Gold");
            if (goldReward) {
              addLog(
                `{green-fg}Nhiệm vụ ${task.description} đã hoàn thành{/green-fg}: Trạng thái ${updatedTask.status}, Phần thưởng Vàng: ${goldReward.quantity}`
              );
            } else {
              addLog(
                `{green-fg}Nhiệm vụ ${task.description} đã hoàn thành{/green-fg}: Trạng thái ${updatedTask.status} (không có Vàng)`
              );
            }
          } else {
            addLog(`{red-fg}Phản hồi xác minh cho nhiệm vụ ${task.description} không được tìm thấy.{/red-fg}`);
          }
        } else {
          addLog(`{red-fg}Phản hồi xác minh cho nhiệm vụ ${task.description} không hợp lệ.{/red-fg}`);
        }
      } else {
        addLog(`{green-fg}Nhiệm vụ ${task.description} đã được nhận thưởng.{/green-fg}`);
      }
    }
    addLog("{green-fg}Tất cả nhiệm vụ đã được xử lý.{/green-fg}");
  } catch (error) {
    addLog(`{red-fg}Lỗi trong Tự động hoàn thành nhiệm vụ: ${error.message}{/red-fg}`);
  } finally {
    autoTaskRunning = false;
    updateMenuItems();
    updateUserInfo();
  }
}

async function autoCompleteDailyCheckinAndTask() {
  autoProcessCancelled = false;
  autoDailyRunning = true;
  updateMenuItems();
  addLog("{bright-yellow-fg}Bắt đầu Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ...{/bright-yellow-fg}");

  try {
    const checkinResponse = await fetch("https://api.fishingfrenzy.co/v1/daily-rewards/claim", {
      method: "GET",
      headers: getRequestHeaders(),
      agent: getAgent()
    });
    if (checkinResponse.status === 200) {
      addLog("{green-fg}Đăng nhập hàng ngày thành công!!{/green-fg}");
    } else if (checkinResponse.status === 400) {
      const json = await checkinResponse.json();
      addLog(`{yellow-fg}Đăng nhập hàng ngày: ${json.message}{/yellow-fg}`);
    } else {
      addLog(`{red-fg}Đăng nhập hàng ngày: Trạng thái không mong đợi: ${checkinResponse.status}{/red-fg}`);
    }
  } catch (error) {
    addLog(`{red-fg}Lỗi khi đăng nhập hàng ngày: ${error.message}{/red-fg}`);
  }

  if (autoProcessCancelled) {
    addLog("{yellow-fg}Quy trình đăng nhập hàng ngày & nhiệm vụ đã bị hủy{/yellow-fg}");
    autoDailyRunning = false;
    updateMenuItems();
    mainMenu.select(0);
    mainMenu.focus();
    screen.render();
    return;
  }

  try {
    const questsResponse = await fetch("https://api.fishingfrenzy.co/v1/user-quests", {
      method: "GET",
      headers: getRequestHeaders(),
      agent: getAgent()
    });
    if (!questsResponse.ok) {
      addLog(`{red-fg}Lỗi khi lấy nhiệm vụ: HTTP ${questsResponse.status}{/red-fg}`);
    } else {
      const quests = await questsResponse.json();
      for (const quest of quests) {
        const reward = quest.rewards && quest.rewards[0] ? quest.rewards[0] : {};
        let statusLabel = "";
        if (quest.isCompleted && quest.isClaimed) {
          statusLabel = "{green-fg}[ĐÃ NHẬN]{/green-fg}";
        } else if (quest.isCompleted && !quest.isClaimed) {
          statusLabel = "{red-fg}[HOÀN THÀNH, CHƯA NHẬN]{/red-fg}";
        } else {
          statusLabel = "{yellow-fg}[ĐANG TIẾN HÀNH]{/yellow-fg}";
        }
        addLog(`{yellow-fg}Nhiệm vụ: ${quest.name} - ${quest.description} | Phần thưởng: ${reward.name || "Không có"} (${reward.quantity || 0}) ${statusLabel}{/yellow-fg}`);
        if (quest.isCompleted && !quest.isClaimed) {
          try {
            const claimResponse = await fetch(`https://api.fishingfrenzy.co/v1/user-quests/${quest.id}/claim`, {
              method: "POST",
              headers: getRequestHeaders(),
              agent: getAgent()
            });
            if (claimResponse.ok) {
              const claimData = await claimResponse.json();
              const resultMessage = claimData.message || claimData.result || "Nhận thưởng thành công";
              addLog(`{green-fg}Nhận thưởng nhiệm vụ ${quest.name} thành công: ${resultMessage}{/green-fg}`);
            } else {
              const claimData = await claimResponse.json();
              addLog(`{red-fg}Nhận thưởng nhiệm vụ ${quest.name} thất bại: ${claimData.message || "Thất bại"}{/red-fg}`);
            }
          } catch (claimError) {
            addLog(`{red-fg}Lỗi khi nhận thưởng nhiệm vụ ${quest.name}: ${claimError.message}{/red-fg}`);
          }
        }
        if (autoProcessCancelled) break;
      }
    }
  } catch (error) {
    addLog(`{red-fg}Lỗi khi lấy nhiệm vụ hàng ngày: ${error.message}{/red-fg}`);
  }

  addLog("{green-fg}Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ đã hoàn tất.{/green-fg}");
  autoDailyRunning = false;
  updateMenuItems();
  mainMenu.select(0);
  mainMenu.focus();
  screen.render();
}

async function fish(range) {
  return new Promise((resolve, reject) => {
    const token = activeToken;
    const agent = getAgent();
    const wsOptions = agent ? { agent } : {};
    const ws = new WebSocket(`wss://api.fishingfrenzy.co/?token=${token}`, wsOptions);
    let gameStarted = false;
    let gameSuccess = false;
    const keyFrames = [];
    const requiredFrames = 10;
    const interpolationSteps = 30;
    let endSent = false;
    const timeout = setTimeout(() => {
      addLog("{yellow-fg}Hết thời gian câu cá - đang đóng kết nối{/yellow-fg}");
      if (ws.readyState === WebSocket.OPEN) ws.close();
      resolve(false);
    }, 30000);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        cmd: 'prepare',
        range: range.toLowerCase().replace(' ', '_'),
        is5x: false
      }));
    });
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'initGame') {
          gameStarted = true;
          ws.send(JSON.stringify({ cmd: 'start' }));
        }
        if (message.type === 'gameState') {
          const frame = message.frame || 0;
          const direction = message.dir || 0;
          const x = 450 + frame * 2 + direction * 5;
          const y = 426 + frame * 2 - direction * 3;
          const entry = direction !== 0 ? [x, y, frame, direction] : [x, y];
          keyFrames.push(entry);
          if (keyFrames.length === requiredFrames && !endSent) {
            let finalFrames = [];
            if (keyFrames.length < 2) {
              finalFrames = keyFrames.slice();
            } else {
              finalFrames.push(keyFrames[0]);
              for (let i = 1; i < keyFrames.length; i++) {
                const prev = keyFrames[i - 1].slice(0, 2);
                const curr = keyFrames[i].slice(0, 2);
                const interpolated = [];
                for (let j = 1; j < interpolationSteps; j++) {
                  const t = j / interpolationSteps;
                  interpolated.push([
                    Math.round(prev[0] + (curr[0] - prev[0]) * t),
                    Math.round(prev[1] + (curr[1] - prev[1]) * t)
                  ]);
                }
                finalFrames.push(...interpolated);
                finalFrames.push(keyFrames[i]);
              }
            }
            const endCommand = {
              cmd: 'end',
              rep: { fs: 100, ns: 200, fps: 20, frs: finalFrames },
              en: 1
            };
            ws.send(JSON.stringify(endCommand));
            endSent = true;
          }
        }
        if (message.type === 'gameOver') {
          gameSuccess = message.success;
          clearTimeout(timeout);
          ws.close();
          if (gameSuccess) {
            const fishInfo = message.catchedFish.fishInfo;
            addLog(`{green-fg}Thành công bắt được cá{/green-fg} {bold}${fishInfo.fishName}{/bold} (chất lượng: ${fishInfo.quality}) trị giá {bold}${fishInfo.sellPrice}{/bold} xu và {bold}${fishInfo.expGain} XP{/bold}!`);
          } else {
            addLog("{red-fg}Thất bại trong việc bắt cá{/red-fg}");
          }
          resolve(gameSuccess);
        }
      } catch (err) {
        addLog(`{red-fg}Lỗi khi phân tích tin nhắn WS: ${err.message}{/red-fg}`);
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      addLog(`{red-fg}Lỗi WebSocket: ${error.message}{/red-fg}`);
      resolve(false);
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      if (!gameStarted) resolve(false);
    });
  });
}

function showCountdown(seconds) {
  return new Promise((resolve) => {
    const countdownBox = blessed.box({
      parent: screen,
      top: '80%',
      left: 'center',
      width: 'shrink',
      height: 3,
      border: { type: 'line' },
      tags: true,
      style: { border: { fg: 'white' }, bg: 'default', fg: 'yellow' }
    });
    let remaining = seconds;
    countdownBox.setContent(`Đếm ngược: ${remaining} giây`);
    screen.render();
    const interval = setInterval(() => {
      remaining--;
      if (remaining >= 0) {
        countdownBox.setContent(`Đếm ngược: ${remaining} giây`);
        screen.render();
      }
      if (remaining < 0) {
        clearInterval(interval);
        countdownBox.destroy();
        screen.render();
        resolve();
      }
    }, 1000);
  });
}

async function processFishing(range, energyCost, times) {
  addLog(`{yellow-fg}Tự động câu cá bắt đầu:{/yellow-fg} {bold}{bright-cyan-fg}${range}{/bright-cyan-fg}{/bold} tổng cộng {bold}{bright-cyan-fg}${times}{/bright-cyan-fg}{/bold} lần câu`);
  for (let i = 1; i <= times; i++) {
    if (autoProcessCancelled) {
      addLog("{yellow-fg}Quy trình Tự động câu cá đã bị hủy.{/yellow-fg}");
      break;
    }
    addLog(`{yellow-fg}Câu cá với khoảng cách{/yellow-fg} {bold}{bright-cyan-fg}${range}{/bright-cyan-fg}{/bold} ({bold}{bright-cyan-fg}${energyCost} Năng lượng{/bright-cyan-fg}{/bold})`);
    let success = false;
    try {
      success = await fish(range);
    } catch (err) {
      addLog(`{red-fg}Lỗi khi câu cá: ${err.message}{/red-fg}`);
    }
    if (success) {
      addLog("{green-fg}Quy trình câu cá thành công.{/green-fg}");
    } else {
      addLog("{red-fg}Quy trình câu cá thất bại.{/red-fg}");
    }
    await updateUserInfo();
    addLog(`{bright-green-fg}Cuộc đua câu cá đã hoàn thành ${i}/${times}{/bright-green-fg}`);
    if (i < times && !autoProcessCancelled) {
      await showCountdown(5);
    }
  }
  addLog(`{green-fg}Tự động câu cá hoàn tất: ${range}{/green-fg}`);
  autoFishingRunning = false;
  updateMenuItems();
  mainMenu.select(0);
  mainMenu.focus();
  screen.render();
}

function showFishingPopup() {
  const fishingContainer = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '50%',
    height: '50%',
    border: { type: "line" },
    label: "Chọn khoảng cách câu cá",
    tags: true,
    style: { border: { fg: 'magenta' } }
  });
  const fishingList = blessed.list({
    parent: fishingContainer,
    top: 1,
    left: 1,
    width: '95%',
    height: '70%',
    keys: true,
    mouse: true,
    vi: true,
    items: [
      'Khoảng cách ngắn (1 Năng lượng)',
      'Khoảng cách trung bình (2 Năng lượng)',
      'Khoảng cách xa (3 Năng lượng)'
    ],
    tags: true,
    style: { selected: { bg: 'magenta', fg: 'black' } }
  });
  const cancelButton = blessed.button({
    parent: fishingContainer,
    bottom: 1,
    left: 'center',
    width: 10,
    height: 1,
    content: ' Hủy ',
    align: 'center',
    mouse: true,
    keys: true,
    shrink: true,
    style: { bg: 'red' }
  });
  fishingList.focus();
  screen.render();
  fishingList.on('select', (item, index) => {
    fishingContainer.destroy();
    screen.render();
    let range, energyCost;
    if (index === 0) { range = 'Short Range'; energyCost = 1; }
    else if (index === 1) { range = 'Mid Range'; energyCost = 2; }
    else if (index === 2) { range = 'Long Range'; energyCost = 3; }
    addLog(`{bright-yellow-fg}Khoảng cách được chọn:{/bright-yellow-fg} {bold}{bright-cyan-fg}${range}{/bright-cyan-fg}{/bold} (Chi phí mỗi lần câu: {bold}{bright-cyan-fg}${energyCost}{/bright-cyan-fg}{/bold} Năng lượng)`);
    promptBox.setFront();
    screen.render();
    promptBox.readInput("Nhập số lần câu cá:", "", async (err, value) => {
      if (err || !value) {
        addLog("{yellow-fg}Đầu vào đã bị hủy.{/yellow-fg}");
        mainMenu.select(0);
        mainMenu.focus();
        screen.render();
        return;
      }
      const times = parseInt(value);
      if (isNaN(times) || times <= 0) {
        addLog("{red-fg}Đầu vào không hợp lệ. Quy trình Tự động câu cá đã bị hủy.{/red-fg}");
        mainMenu.select(0);
        mainMenu.focus();
        screen.render();
        return;
      }
      const totalCost = energyCost * times;
      if (totalCost > currentEnergy) {
        addLog(`{yellow-fg}Năng lượng không đủ!{/yellow-fg} Năng lượng hiện có: {bright-red-fg}${currentEnergy}{/bright-red-fg}, Năng lượng cần thiết: {bright-green-fg}${totalCost}.{/bright-green-fg}`);
        mainMenu.select(0);
        mainMenu.focus();
        screen.render();
        return;
      }
      autoProcessCancelled = false;
      autoFishingRunning = true;
      updateMenuItems();
      mainMenu.select(0);
      mainMenu.focus();
      screen.render();
      await processFishing(range, energyCost, times);
    });
  });
  cancelButton.on('press', () => {
    fishingContainer.destroy();
    addLog("{yellow-fg}Tự động câu cá đã bị hủy.{/yellow-fg}");
    autoProcessCancelled = false;
    mainMenu.select(0);
    mainMenu.focus();
    screen.render();
  });
  fishingContainer.key(['escape'], () => {
    fishingContainer.destroy();
    addLog("{yellow-fg}Tự động câu cá đã bị hủy.{/yellow-fg}");
    autoProcessCancelled = false;
    mainMenu.select(0);
    mainMenu.focus();
    screen.render();
  });
}

async function changedAccount() {
  if (accountPromptActive) return;
  accountPromptActive = true;

  const allTokens = fs.readFileSync("token.txt", "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");
  if (allTokens.length === 0) {
    addLog("{red-fg}Không có tài khoản trong token.txt{/red-fg}");
    accountPromptActive = false;
    return;
  }
  const reqHeaders = getRequestHeaders();
  const accountPromises = allTokens.map(token =>
    fetch("https://api.fishingfrenzy.co/v1/users/me", { headers: { ...reqHeaders, 'authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : null)
      .catch(() => null)
  );
  const accounts = await Promise.all(accountPromises);
  const accountItems = accounts.map((acc, index) => {
    if (acc) {
      let label = `${acc.username} - ${getShortAddress(acc.walletAddress)}`;
      if (allTokens[index] === activeToken) label += " [Đang hoạt động]";
      return { token: allTokens[index], label };
    }
    return { token: allTokens[index], label: `Tài khoản không hợp lệ ${index + 1}` };
  });
  const accountList = blessed.list({
    parent: screen,
    top: "center",
    left: "center",
    width: "50%",
    height: "60%",
    border: { type: "line" },
    label: "Chọn tài khoản",
    keys: true,
    mouse: true,
    vi: true,
    items: accountItems.map(item => item.label),
    tags: true,
    style: { selected: { bg: "green", fg: "black" } }
  });
  screen.append(accountList);
  accountList.focus();
  screen.render();
  accountList.on("select", (item, index) => {
    screen.remove(accountList);
    screen.render();
    if (accountItems[index] && accountItems[index].label.indexOf("Invalid") === -1) {
      const newToken = accountItems[index].token;
      showProxyPrompt(newToken, accountItems[index].label);
    } else {
      addLog("{red-fg}Tài khoản không hợp lệ đã được chọn.{/red-fg}");
      mainMenu.select(0);
      mainMenu.focus();
      screen.render();
      accountPromptActive = false; 
    }
  });

  accountList.key("escape", () => {
    screen.remove(accountList);
    screen.render();
    accountPromptActive = false;
  });
}

function showProxyPrompt(newToken, accountLabel) {
  const proxyPrompt = blessed.list({
    parent: screen,
    top: "center",
    left: "center",
    width: "50%",
    height: "40%",
    border: { type: "line" },
    label: "Sử dụng proxy?",
    keys: true,
    mouse: true,
    vi: true,
    items: ["Không", "Có"],
    tags: true,
    style: { selected: { bg: "green", fg: "black" } }
  });
  screen.append(proxyPrompt);
  proxyPrompt.focus();
  screen.render();
  proxyPrompt.on("select", async (pItem, pIndex) => {
    proxyPrompt.destroy();
    screen.render();
    if (pIndex === 1) { 
      let proxies = [];
      try {
        proxies = fs.readFileSync("proxy.txt", "utf8")
          .split("\n")
          .map(line => line.trim())
          .filter(line => line !== "");
      } catch (err) {
        addLog("{red-fg}Lỗi khi đọc proxy.txt{/red-fg}");
      }
      if (proxies.length === 0) {
        addLog("{yellow-fg}Không có proxy trong proxy.txt, sử dụng mà không có proxy.{/yellow-fg}");
        activeProxy = null;
        activeToken = newToken;
        updateUserInfo();
        mainMenu.select(0);
        mainMenu.focus();
        screen.render();
        accountPromptActive = false;
      } else {
        showProxySelection(proxies, newToken, accountLabel);
      }
    } else {
      activeProxy = null;
      activeToken = newToken;
      addLog(`Đã thay đổi tài khoản thành: ${accountLabel}`);
      updateUserInfo();
      mainMenu.select(0);
      mainMenu.focus();
      screen.render();
      accountPromptActive = false;
    }
  });
}

function showProxySelection(proxies, newToken, accountLabel) {
  const proxyContainer = blessed.box({
    parent: screen,
    top: "center",
    left: "center",
    width: "50%",
    height: "50%",
    border: { type: "line" },
    label: "Chọn Proxy",
    tags: true
  });
  const proxyList = blessed.list({
    parent: proxyContainer,
    top: 1,
    left: 1,
    width: '95%',
    height: '70%',
    keys: true,
    mouse: true,
    vi: true,
    items: proxies.map(p => p === activeProxy ? `${p} [Đang hoạt động]` : p),
    tags: true,
    style: { selected: { bg: 'green', fg: 'black' } }
  });
  const cancelButton = blessed.button({
    parent: proxyContainer,
    bottom: 1,
    left: 'center',
    width: 10,
    height: 1,
    content: ' Hủy ',
    align: 'center',
    mouse: true,
    keys: true,
    shrink: true,
    style: { bg: 'red' }
  });
  proxyList.focus();
  screen.render();
  proxyList.on("select", (pItem, pIndex) => {
    proxyContainer.destroy();
    screen.render();
    activeProxy = proxies[pIndex];
    activeToken = newToken;
    addLog(`Đã thay đổi tài khoản thành: ${accountLabel} với proxy: ${activeProxy}`);
    updateUserInfo();
    mainMenu.select(0);
    mainMenu.focus();
    screen.render();
    accountPromptActive = false;
  });
  cancelButton.on("press", () => {
    proxyContainer.destroy();
    screen.render();
    showProxyPrompt(newToken, accountLabel);
  });
}

async function autoFishing() {
  showFishingPopup();
}

mainMenu.on("select", (item) => {
  const text = item.getText();
  
  if ((autoTaskRunning || autoFishingRunning || autoDailyRunning) && text !== "Dừng tiến trình") {
    addLog("{yellow-fg}Đang có tiến trình chạy. Vui lòng đợi tiến trình hoàn tất hoặc chọn 'Dừng tiến trình'.{/yellow-fg}");
    return;
  }
  
  if (text === "Dừng tiến trình") {
    autoProcessCancelled = true;
    addLog("{red-fg}Dừng tiến trình đã được chấp nhận. Tiến trình sẽ bị dừng lại.{/red-fg}");
    return;
  }
  switch (text) {
    case "Tự động hoàn thành nhiệm vụ":
      autoCompleteTask();
      break;
    case "Tự động câu cá":
      autoFishing();
      break;
    case "Tự động hoàn thành đăng nhập hàng ngày & nhiệm vụ":
      autoCompleteDailyCheckinAndTask();
      break;
    case "Thay đổi tài khoản":
      changedAccount();
      break;
    case "Xóa nhật ký":
      clearLogs();
      break;
    case "Làm mới":
      updateUserInfo();
      break;
    case "Thoát":
      process.exit(0);
      break;
    default:
      addLog("{red-fg}Thực đơn không được nhận diện hoặc không có hành động.{/red-fg}");
  }
});

screen.key(["escape", "q", "C-c"], () => process.exit(0));

updateMenuItems();
mainMenu.focus();
safeRender();
screen.render();

function adjustLayout() {
  const { width, height } = screen;
  headerBox.width = "100%";
  headerBox.height = headerContentHeight;
  logsBox.top = headerBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(width * 0.6);
  logsBox.height = height - headerBox.height;
  const rightHeight = height - headerBox.height;
  const userInfoHeight = Math.max(Math.floor(rightHeight * 0.35), 10);
  userInfoBox.top = headerBox.height;
  userInfoBox.left = Math.floor(width * 0.6);
  userInfoBox.width = Math.floor(width * 0.4);
  userInfoBox.height = userInfoHeight;
  mainMenu.top = headerBox.height + userInfoHeight;
  mainMenu.left = Math.floor(width * 0.6);
  mainMenu.width = Math.floor(width * 0.4);
  mainMenu.height = height - headerBox.height - userInfoHeight;
  safeRender();
}

screen.on("resize", adjustLayout);
adjustLayout();

changedAccount();
