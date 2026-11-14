"use strict";

// ========================================
// 1. 页面元素
// ========================================

const $ = (selector) => document.querySelector(selector);

const world = $("#world");
const ctx = world.getContext("2d");
const chart = $("#chart");
const chartCtx = chart.getContext("2d");

const playButton = $("#playButton");
const resetButton = $("#resetButton");
const growthInput = $("#growthInput");
const speedInput = $("#speedInput");
const toolButtons = document.querySelectorAll(".tool");

const ui = {
  plantCount: $("#plantCount"),
  herbCount: $("#herbCount"),
  predCount: $("#predCount"),
  time: $("#timeText"),
  state: $("#runState"),
  hint: $("#toolHint"),
  growth: $("#growthValue"),
  speed: $("#speedValue"),
  events: $("#eventList"),
  inspector: $("#inspectorContent"),

  guideButton: $("#guideButton"),
  guideText: $("#guideText"),
  guideSteps: [
    $("#guideStep1"),
    $("#guideStep2"),
    $("#guideStep3")
  ],

  challengePanel: $("#challengePanel"),
  challengeButton: $("#challengeButton"),
  challengeStatus: $("#challengeStatus"),
  challengeTime: $("#challengeTime"),
  challengeProgress: $("#challengeProgress"),
  challengeMessage: $("#challengeMessage")
};

// ========================================
// 2. 原版生态参数：保持不变
// ========================================

const CONFIG = {
  maxPlants: 240,
  maxHerbivores: 70,
  maxPredators: 18,

  initialPlants: 110,
  initialHerbivores: 12,
  initialPredators: 2,

  herbivore: {
    speed: 36,
    sense: 150,
    energyStart: 65,
    energyLoss: 2.1,
    foodEnergy: 25,
    birthEnergy: 112,
    birthCost: 48,
    birthCooldown: 20
  },

  predator: {
    speed: 47,
    sense: 200,
    energyStart: 95,
    energyLoss: 2.7,
    foodEnergy: 48,
    birthEnergy: 155,
    birthCost: 70,
    birthCooldown: 30
  }
};

const COLORS = {
  plant: "#398653",
  herbivore: "#387aba",
  predator: "#c57030",
  observe: "#28694c"
};

const TOOL_NAMES = {
  plant: "植物",
  herbivore: "食草动物",
  predator: "捕食者"
};

const STEP = 1 / 30;
const CHALLENGE_SECONDS = 60;

// ========================================
// 3. 世界与交互状态
// ========================================

let plants = [];
let herbivores = [];
let predators = [];

let running = false;
let selectedTool = "observe";
let selectedAnimal = null;
let nextAnimalId = 1;

let simulationTime = 0;
let plantBudget = 0;
let history = [];
let historyClock = 0;

let events = [];
let eventTimes = {};

let previousTimestamp = null;
let accumulator = 0;
let interfaceClock = 0;

const pointer = {
  x: 0,
  y: 0,
  inside: false
};

// step 为 0、1、2 时分别等待三个引导操作。
const guide = {
  active: false,
  step: 0,
  completed: false
};

const challenge = {
  active: false,
  completed: false,
  elapsed: 0
};

// ========================================
// 4. 通用工具
// ========================================

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomPosition() {
  return {
    x: randomBetween(15, world.width - 15),
    y: randomBetween(15, world.height - 15)
  };
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function findNearest(animal, items, sense) {
  let target = null;
  let bestDistance = sense * sense;

  for (const item of items) {
    const distance = distanceSquared(animal, item);

    if (distance < bestDistance) {
      bestDistance = distance;
      target = item;
    }
  }

  return target;
}

function getAnimals(type) {
  return type === "herbivore" ? herbivores : predators;
}

function getAnimalLimit(type) {
  return type === "herbivore"
    ? CONFIG.maxHerbivores
    : CONFIG.maxPredators;
}

function addEvent(message, key = message, interval = 6) {
  const lastTime = eventTimes[key];

  if (
    lastTime !== undefined &&
    simulationTime - lastTime < interval
  ) {
    return;
  }

  eventTimes[key] = simulationTime;
  events.unshift({
    time: Math.floor(simulationTime),
    message
  });

  events = events.slice(0, 6);
  ui.events.replaceChildren();

  for (const event of events) {
    const li = document.createElement("li");
    li.textContent = `${event.time} 秒：${event.message}`;
    ui.events.appendChild(li);
  }
}

// ========================================
// 5. 创建生物
// ========================================

function createPlant(x, y) {
  return {
    x,
    y,
    radius: randomBetween(3, 5)
  };
}

function createAnimal(type, x, y) {
  const settings = CONFIG[type];

  return {
    id: nextAnimalId++,
    type,
    x,
    y,
    angle: randomBetween(0, Math.PI * 2),
    turnClock: randomBetween(0.3, 1.5),
    energy: settings.energyStart,
    cooldown: settings.birthCooldown * randomBetween(0.5, 1),
    flash: 0,
    deathReason: ""
  };
}

function addEntity(type, x, y, manual = false) {
  if (!Object.hasOwn(TOOL_NAMES, type)) return false;

  x = clamp(x, 12, world.width - 12);
  y = clamp(y, 12, world.height - 12);

  const items = type === "plant" ? plants : getAnimals(type);
  const limit = type === "plant"
    ? CONFIG.maxPlants
    : getAnimalLimit(type);

  if (items.length >= limit) {
    if (manual) {
      addEvent(
        `${TOOL_NAMES[type]}已达到数量上限。`,
        `${type}-limit`,
        0
      );
    }

    return false;
  }

  if (type === "plant") {
    items.push(createPlant(x, y));
  } else {
    items.push(createAnimal(type, x, y));
  }

  if (manual) {
    addEvent(
      `手动添加了${TOOL_NAMES[type]}。`,
      "manual-add",
      0
    );

    advanceGuide(type);
  }

  return true;
}

// 第 1 / 4 部分结束。
// 下一部分直接接在此行下面。
// ========================================
// 6. 动物移动
// ========================================

function moveAnimal(animal, target, settings, dt) {
  if (target) {
    animal.angle = Math.atan2(
      target.y - animal.y,
      target.x - animal.x
    );
  } else {
    animal.turnClock -= dt;

    if (animal.turnClock <= 0) {
      animal.angle += randomBetween(-1.1, 1.1);
      animal.turnClock = randomBetween(0.6, 1.8);
    }
  }

  animal.x += Math.cos(animal.angle) * settings.speed * dt;
  animal.y += Math.sin(animal.angle) * settings.speed * dt;

  const margin = 10;

  if (animal.x < margin || animal.x > world.width - margin) {
    animal.angle = Math.PI - animal.angle;
    animal.x = clamp(animal.x, margin, world.width - margin);
  }

  if (animal.y < margin || animal.y > world.height - margin) {
    animal.angle = -animal.angle;
    animal.y = clamp(animal.y, margin, world.height - margin);
  }
}

// ========================================
// 7. 进食、死亡与繁殖
// ========================================

function updateAnimals(type, dt) {
  const isHerbivore = type === "herbivore";
  const animals = getAnimals(type);
  const food = isHerbivore ? plants : herbivores;
  const settings = CONFIG[type];
  const limit = getAnimalLimit(type);
  const newborns = [];

  for (let i = animals.length - 1; i >= 0; i--) {
    const animal = animals[i];

    animal.energy -= settings.energyLoss * dt;
    animal.cooldown = Math.max(0, animal.cooldown - dt);
    animal.flash = Math.max(0, animal.flash - dt);

    if (animal.energy <= 0) {
      animal.energy = 0;
      animal.deathReason = "能量耗尽";
      animals.splice(i, 1);

      addEvent(
        `${TOOL_NAMES[type]}因能量耗尽死亡。`,
        `${type}-starved`,
        8
      );

      continue;
    }

    const target = findNearest(animal, food, settings.sense);
    moveAnimal(animal, target, settings, dt);

    const eatDistance = isHerbivore ? 12 : 16;

    if (
      target &&
      distanceSquared(animal, target) < eatDistance * eatDistance
    ) {
      const foodIndex = food.indexOf(target);

      if (foodIndex !== -1) {
        if (!isHerbivore) {
          target.deathReason = "被捕食者捕获";
        }

        food.splice(foodIndex, 1);
        animal.energy += settings.foodEnergy;
        animal.flash = 0.25;

        if (!isHerbivore) {
          addEvent(
            "捕食者成功捕获一只食草动物。",
            "predation",
            8
          );
        }
      }
    }

    const canReproduce =
      animal.energy >= settings.birthEnergy &&
      animal.cooldown <= 0 &&
      animals.length + newborns.length < limit;

    if (canReproduce) {
      animal.energy -= settings.birthCost;
      animal.cooldown = settings.birthCooldown;

      const baby = createAnimal(
        type,
        clamp(
          animal.x + randomBetween(-12, 12),
          12,
          world.width - 12
        ),
        clamp(
          animal.y + randomBetween(-12, 12),
          12,
          world.height - 12
        )
      );

      baby.flash = 0.6;
      newborns.push(baby);

      addEvent(
        `${TOOL_NAMES[type]}产生了一个后代。`,
        `${type}-birth`,
        10
      );
    }
  }

  animals.push(...newborns);
}

// ========================================
// 8. 历史记录与世界更新
// ========================================

function recordHistory() {
  history.push({
    time: simulationTime,
    plants: plants.length,
    herbivores: herbivores.length,
    predators: predators.length
  });

  if (history.length > 180) {
    history.shift();
  }
}

function updateWorld(dt) {
  const previousHerbCount = herbivores.length;
  const previousPredCount = predators.length;

  simulationTime += dt;

  const growthRate = Number(growthInput.value);

  if (plants.length < CONFIG.maxPlants) {
    plantBudget += growthRate * dt;

    while (
      plantBudget >= 1 &&
      plants.length < CONFIG.maxPlants
    ) {
      const position = randomPosition();
      addEntity("plant", position.x, position.y);
      plantBudget -= 1;
    }
  } else {
    plantBudget = 0;
  }

  updateAnimals("herbivore", dt);
  updateAnimals("predator", dt);

  if (previousHerbCount > 0 && herbivores.length === 0) {
    addEvent(
      "食草动物已经消失，可以手动补充。",
      "herb-extinct",
      0
    );
  }

  if (previousPredCount > 0 && predators.length === 0) {
    addEvent(
      "捕食者已经消失，可以补充或继续观察。",
      "pred-extinct",
      0
    );
  }

  updateChallenge(dt);

  historyClock += dt;

  if (historyClock >= 1) {
    historyClock -= 1;
    recordHistory();
  }
}

// ========================================
// 9. 新手引导
// ========================================

function startGuide() {
  guide.active = true;
  guide.completed = false;
  guide.step = 0;

  running = false;
  accumulator = 0;

  selectTool("plant");

  addEvent(
    "引导开始：先在生态区域添加一株植物。",
    "guide-start",
    0
  );

  updateInterface();
}

function advanceGuide(action) {
  if (!guide.active) return;

  if (guide.step === 0 && action === "plant") {
    guide.step = 1;
    selectTool("herbivore");
  } else if (guide.step === 1 && action === "herbivore") {
    guide.step = 2;
  } else if (guide.step === 2 && action === "play") {
    guide.step = 3;
    guide.active = false;
    guide.completed = true;

    addEvent(
      "引导完成！试试暂停后使用观察工具查看动物。",
      "guide-complete",
      0
    );
  }

  updateInterface();
}

function updateGuideInterface() {
  const messages = [
    "第 1 步：已选中植物工具，请点击生态区域添加一株植物。",
    "第 2 步：已选中食草动物工具，请点击生态区域添加一只。",
    "第 3 步：点击“开始模拟”，观察动物寻找食物。"
  ];

  ui.guideButton.textContent =
    guide.active ? "重新开始引导" : "开始引导";

  if (guide.active) {
    ui.guideText.textContent = messages[guide.step];
  } else if (guide.completed) {
    ui.guideText.textContent =
      "引导完成。你可以使用观察工具查看能量，或开始共存挑战。";
    ui.guideButton.textContent = "再做一次引导";
  } else {
    ui.guideText.textContent =
      "引导会带你添加植物、添加食草动物，并启动模拟。也可以直接自由探索。";
  }

  ui.guideSteps.forEach((element, index) => {
    element.classList.toggle(
      "active",
      guide.active && index === guide.step
    );

    element.classList.toggle(
      "done",
      guide.completed || (guide.active && index < guide.step)
    );
  });

  playButton.classList.toggle(
    "guide-focus",
    guide.active && guide.step === 2
  );
}

// ========================================
// 10. 连续共存挑战
// ========================================

function startChallenge() {
  challenge.active = true;
  challenge.completed = false;
  challenge.elapsed = 0;

  addEvent(
    "共存挑战开始：让三类生物连续共存 60 个模拟秒。",
    "challenge-start",
    0
  );

  // 不清空世界，也不自动开始或暂停模拟。
  updateInterface();
}

function updateChallenge(dt) {
  if (!challenge.active) return;

  const allPresent =
    plants.length > 0 &&
    herbivores.length > 0 &&
    predators.length > 0;

  if (!allPresent) {
    if (challenge.elapsed > 0) {
      addEvent(
        "有一类生物消失，共存挑战的连续计时归零。",
        "challenge-interrupted",
        3
      );
    }

    challenge.elapsed = 0;
    return;
  }

  challenge.elapsed = Math.min(
    CHALLENGE_SECONDS,
    challenge.elapsed + dt
  );

  if (challenge.elapsed >= CHALLENGE_SECONDS - 0.000001) {
    challenge.elapsed = CHALLENGE_SECONDS;
    challenge.active = false;
    challenge.completed = true;

    addEvent(
      "挑战完成！三类生物已连续共存 60 个模拟秒。",
      "challenge-complete",
      0
    );
  }
}

function updateChallengeInterface() {
  ui.challengeProgress.max = CHALLENGE_SECONDS;
  ui.challengeProgress.value = challenge.elapsed;

  ui.challengeTime.textContent =
    `${Math.floor(challenge.elapsed)} / ${CHALLENGE_SECONDS} 模拟秒`;

  ui.challengePanel.classList.toggle(
    "is-complete",
    challenge.completed
  );

  ui.challengeButton.textContent =
    challenge.active || challenge.completed
      ? "重新开始挑战"
      : "开始挑战";

  if (challenge.completed) {
    ui.challengeStatus.textContent = "挑战完成";
    ui.challengeMessage.textContent =
      "你已完成共存维护。可以继续观察，但这不代表系统已达到自行维持的平衡。";
  } else if (challenge.active) {
    const allPresent =
      plants.length > 0 &&
      herbivores.length > 0 &&
      predators.length > 0;

    ui.challengeStatus.textContent = !allPresent
      ? "等待三类生物齐全"
      : running
        ? "正在累计连续共存时间"
        : "模拟已暂停，挑战计时暂停";

    ui.challengeMessage.textContent =
      "允许补充生物；任意一类消失，连续共存进度归零。";
  } else {
    ui.challengeStatus.textContent = "尚未开始";
    ui.challengeMessage.textContent =
      "开始挑战不会清空当前世界。请点击“开始挑战”参与。";
  }
}

// 第 2 / 4 部分结束。
// ========================================
// 11. 绘制动物
// ========================================

function drawAnimal(animal) {
  ctx.save();
  ctx.translate(animal.x, animal.y);

  if (animal === selectedAnimal) {
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.observe;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (animal.flash > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201, 159, 56, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.rotate(animal.angle);
  ctx.fillStyle = COLORS[animal.type];

  ctx.beginPath();

  if (animal.type === "herbivore") {
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(3, -2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ========================================
// 12. 绘制世界
// ========================================

function drawWorld() {
  ctx.clearRect(0, 0, world.width, world.height);
  ctx.fillStyle = "#f6f8f0";
  ctx.fillRect(0, 0, world.width, world.height);

  ctx.strokeStyle = "rgba(90, 120, 90, 0.07)";
  ctx.lineWidth = 1;

  for (let x = 0; x < world.width; x += 45) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, world.height);
    ctx.stroke();
  }

  for (let y = 0; y < world.height; y += 45) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = COLORS.plant;

  for (const plant of plants) {
    ctx.beginPath();
    ctx.arc(plant.x, plant.y, plant.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const animal of herbivores) drawAnimal(animal);
  for (const animal of predators) drawAnimal(animal);

  if (pointer.inside) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS[selectedTool];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(
      pointer.x,
      pointer.y,
      selectedTool === "observe" ? 20 : 14,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
  }

  if (!running) {
    ctx.fillStyle = "rgba(36, 53, 44, 0.8)";
    ctx.font = "16px sans-serif";
    ctx.fillText("已暂停 · 可以观察或添加生物", 18, 28);
  }
}

// ========================================
// 13. 绘制数量变化
// ========================================

function drawChart() {
  const width = chart.width;
  const height = chart.height;
  const left = 42;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  chartCtx.clearRect(0, 0, width, height);

  let maxValue = 20;

  for (const sample of history) {
    maxValue = Math.max(
      maxValue,
      sample.plants,
      sample.herbivores,
      sample.predators
    );
  }

  maxValue = Math.ceil(maxValue / 20) * 20;

  chartCtx.font = "12px sans-serif";
  chartCtx.textAlign = "right";
  chartCtx.lineWidth = 1;

  for (let i = 0; i <= 4; i++) {
    const y = top + (plotHeight * i) / 4;

    chartCtx.strokeStyle = "#e4e9e1";
    chartCtx.beginPath();
    chartCtx.moveTo(left, y);
    chartCtx.lineTo(width - right, y);
    chartCtx.stroke();

    chartCtx.fillStyle = "#647469";
    chartCtx.fillText(
      String(Math.round(maxValue * (1 - i / 4))),
      left - 8,
      y + 4
    );
  }

  if (history.length === 0) return;

  const firstTime = history[0].time;
  const lastTime = history[history.length - 1].time;
  const timeRange = Math.max(1, lastTime - firstTime);

  const series = [
    ["plants", COLORS.plant],
    ["herbivores", COLORS.herbivore],
    ["predators", COLORS.predator]
  ];

  for (const [key, color] of series) {
    chartCtx.beginPath();
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 2;

    history.forEach((sample, index) => {
      const x =
        left + ((sample.time - firstTime) / timeRange) * plotWidth;
      const y =
        top + plotHeight - (sample[key] / maxValue) * plotHeight;

      if (index === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    });

    chartCtx.stroke();
  }

  chartCtx.fillStyle = "#647469";
  chartCtx.textAlign = "left";
  chartCtx.fillText(`${Math.floor(firstTime)} 秒`, left, height - 8);
  chartCtx.textAlign = "right";
  chartCtx.fillText(
    `${Math.floor(lastTime)} 秒`,
    width - right,
    height - 8
  );
}

// ========================================
// 14. 个体状态面板
// ========================================

function updateInspector() {
  const animal = selectedAnimal;

  if (!animal) {
    ui.inspector.textContent =
      "选择“观察动物”，再点击一只动物。建议先暂停，方便选中。";
    return;
  }

  ui.inspector.replaceChildren();

  const title = document.createElement("p");
  title.className = "inspector-name";
  title.textContent = `${TOOL_NAMES[animal.type]} · #${animal.id}`;
  ui.inspector.appendChild(title);

  if (animal.deathReason) {
    const note = document.createElement("p");
    note.className = "inspector-status";
    note.textContent =
      `该个体已离开世界：${animal.deathReason}。请选择其他动物继续观察。`;
    ui.inspector.appendChild(note);
    return;
  }

  const settings = CONFIG[animal.type];
  const grid = document.createElement("div");
  grid.className = "inspector-grid";

  const entries = [
    ["当前能量", animal.energy.toFixed(1)],
    ["繁殖能量门槛", String(settings.birthEnergy)],
    ["冷却剩余", `${Math.max(0, animal.cooldown).toFixed(1)} 模拟秒`],
    ["同类数量", `${getAnimals(animal.type).length} / ${getAnimalLimit(animal.type)}`]
  ];

  for (const [label, value] of entries) {
    const item = document.createElement("div");
    item.className = "inspector-item";

    const name = document.createElement("span");
    name.textContent = label;

    const number = document.createElement("strong");
    number.textContent = value;

    item.append(name, number);
    grid.appendChild(item);
  }

  ui.inspector.appendChild(grid);

  const reasons = [];

  if (animal.energy < settings.birthEnergy) {
    reasons.push("能量未达到繁殖门槛");
  }

  if (animal.cooldown > 0) {
    reasons.push("繁殖冷却尚未结束");
  }

  if (getAnimals(animal.type).length >= getAnimalLimit(animal.type)) {
    reasons.push("同类数量已达上限");
  }

  const status = document.createElement("p");
  status.className = "inspector-status";
  status.textContent = reasons.length
    ? `尚不能繁殖：${reasons.join("；")}。`
    : "当前满足繁殖条件，将在后续模拟更新中再次检查。";

  ui.inspector.appendChild(status);
}

// 第 3 / 4 部分结束。
// 第四部分直接接在此行下面。
// ========================================
// 15. 更新界面与选择工具
// ========================================

function updateInterface() {
  ui.plantCount.textContent = plants.length;
  ui.herbCount.textContent = herbivores.length;
  ui.predCount.textContent = predators.length;

  ui.time.textContent = `${Math.floor(simulationTime)} 模拟秒`;
  ui.state.textContent = running ? "运行中" : "已暂停";
  ui.state.classList.toggle("is-running", running);

  playButton.textContent = running ? "暂停模拟" : "开始模拟";
  ui.growth.textContent = `${growthInput.value} 株/模拟秒`;
  ui.speed.textContent = `${speedInput.value}×`;

  ui.hint.textContent = selectedTool === "observe"
    ? "当前工具：观察动物 · 点击动物查看状态"
    : `当前工具：添加${TOOL_NAMES[selectedTool]}`;

  updateInspector();
  updateGuideInterface();
  updateChallengeInterface();
}

function selectTool(type) {
  if (
    type !== "observe" &&
    !Object.hasOwn(TOOL_NAMES, type)
  ) {
    return;
  }

  selectedTool = type;

  for (const button of toolButtons) {
    const active = button.dataset.tool === type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  world.style.cursor =
    type === "observe" ? "pointer" : "crosshair";

  updateInterface();
}

// ========================================
// 16. 从实际配置生成数值规则
// ========================================

function fillRuleValues(selector, entries) {
  const container = $(selector);
  container.replaceChildren();

  for (const [label, value] of entries) {
    const row = document.createElement("div");
    row.className = "rule-row";

    const name = document.createElement("dt");
    name.textContent = label;

    const content = document.createElement("dd");
    content.textContent = String(value);

    row.append(name, content);
    container.appendChild(row);
  }
}

function renderRules() {
  fillRuleValues("#plantRules", [
    ["初始数量", `${CONFIG.initialPlants} 株`],
    ["数量上限", `${CONFIG.maxPlants} 株`],
    ["当前生成速度", `${growthInput.value} 株/模拟秒`],
    ["生成位置", "生态区域内随机位置"],
    ["消失原因", "被食草动物吃掉"]
  ]);

  for (const type of ["herbivore", "predator"]) {
    const settings = CONFIG[type];
    const isHerbivore = type === "herbivore";

    fillRuleValues(
      isHerbivore ? "#herbivoreRules" : "#predatorRules",
      [
        [
          "初始数量",
          `${isHerbivore
            ? CONFIG.initialHerbivores
            : CONFIG.initialPredators} 只`
        ],
        ["数量上限", `${getAnimalLimit(type)} 只`],
        ["初始能量", settings.energyStart],
        ["每模拟秒耗能", settings.energyLoss],
        ["每次进食增能", `+${settings.foodEnergy}`],
        ["繁殖能量门槛", `≥ ${settings.birthEnergy}`],
        ["亲代繁殖耗能", settings.birthCost],
        ["繁殖后冷却", `${settings.birthCooldown} 模拟秒`],
        [
          "创建时初始冷却",
          `${settings.birthCooldown * 0.5}～${settings.birthCooldown} 模拟秒`
        ],
        ["每次后代数量", "1 只，无需配偶"],
        ["移动速度", `${settings.speed} 画布单位/模拟秒`],
        ["感知半径", `${settings.sense} 画布单位`]
      ]
    );
  }
}

// ========================================
// 17. 重置世界
// ========================================

function resetWorld() {
  running = false;
  selectedAnimal = null;
  nextAnimalId = 1;

  plants = [];
  herbivores = [];
  predators = [];

  simulationTime = 0;
  plantBudget = 0;
  historyClock = 0;
  interfaceClock = 0;
  accumulator = 0;
  previousTimestamp = null;

  history = [];
  events = [];
  eventTimes = {};
  ui.events.replaceChildren();

  guide.active = false;
  guide.completed = false;
  guide.step = 0;

  challenge.active = false;
  challenge.completed = false;
  challenge.elapsed = 0;

  pointer.inside = false;

  growthInput.value = "4";
  speedInput.value = "1";

  const initialGroups = [
    ["plant", CONFIG.initialPlants],
    ["herbivore", CONFIG.initialHerbivores],
    ["predator", CONFIG.initialPredators]
  ];

  for (const [type, count] of initialGroups) {
    for (let i = 0; i < count; i++) {
      const position = randomPosition();
      addEntity(type, position.x, position.y);
    }
  }

  selectTool("observe");
  renderRules();
  recordHistory();

  addEvent(
    "世界已准备好。可以开始模拟、参与引导，或选择动物观察。",
    "reset",
    0
  );

  updateInterface();
  drawWorld();
  drawChart();
}

// ========================================
// 18. 画布交互
// ========================================

function getCanvasPosition(event) {
  const rect = world.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) * (world.width / rect.width),
    y: (event.clientY - rect.top) * (world.height / rect.height)
  };
}

world.addEventListener("pointermove", (event) => {
  const position = getCanvasPosition(event);
  pointer.x = position.x;
  pointer.y = position.y;
  pointer.inside = true;
});

world.addEventListener("pointerleave", () => {
  pointer.inside = false;
});

world.addEventListener("pointercancel", () => {
  pointer.inside = false;
});

world.addEventListener("click", (event) => {
  const position = getCanvasPosition(event);

  if (selectedTool === "observe") {
    // 手机画布显示较小时，适当扩大点击命中范围。
    const rect = world.getBoundingClientRect();
    const hitRadius = Math.max(
      20,
      12 * world.width / Math.max(1, rect.width)
    );

    selectedAnimal = findNearest(
      position,
      [...herbivores, ...predators],
      hitRadius
    );
  } else {
    addEntity(
      selectedTool,
      position.x,
      position.y,
      true
    );
  }

  updateInterface();
  drawWorld();
});

// ========================================
// 19. 按钮与滑块
// ========================================

for (const button of toolButtons) {
  button.addEventListener("click", () => {
    selectTool(button.dataset.tool);
  });
}

playButton.addEventListener("click", () => {
  running = !running;
  accumulator = 0;
  previousTimestamp = null;

  if (running) {
    advanceGuide("play");
  }

  updateInterface();
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "确定重置吗？生物、模拟记录、引导和挑战进度都将被清除。"
  );

  if (confirmed) {
    resetWorld();
  }
});

ui.guideButton.addEventListener("click", startGuide);
ui.challengeButton.addEventListener("click", startChallenge);

growthInput.addEventListener("input", () => {
  renderRules();
  updateInterface();
});

speedInput.addEventListener("input", () => {
  accumulator = 0;
  previousTimestamp = null;
  updateInterface();
});

document.addEventListener("visibilitychange", () => {
  // 不补算离开标签页期间的时间。
  previousTimestamp = null;
  accumulator = 0;
});

// ========================================
// 20. 动画循环与启动
// ========================================

function frame(timestamp) {
  if (previousTimestamp === null) {
    previousTimestamp = timestamp;
  }

  const realDelta = clamp(
    (timestamp - previousTimestamp) / 1000,
    0,
    0.1
  );

  previousTimestamp = timestamp;

  if (running && !document.hidden) {
    accumulator += realDelta * Number(speedInput.value);

    while (accumulator >= STEP) {
      updateWorld(STEP);
      accumulator -= STEP;
    }
  }

  drawWorld();

  // 数字、观察面板和图表每秒最多更新约 10 次，
  // 避免每一帧都重复创建界面元素。
  interfaceClock += realDelta;

  if (interfaceClock >= 0.1) {
    interfaceClock = 0;
    updateInterface();
    drawChart();
  }

  requestAnimationFrame(frame);
}

resetWorld();
requestAnimationFrame(frame);

// 第 4 / 4 部分结束，app.js 全部代码结束。
