"use strict";

// ========================================
// 1. 找到网页中的元素
// ========================================

const world = document.querySelector("#world");
const ctx = world.getContext("2d");

const chart = document.querySelector("#chart");
const chartCtx = chart.getContext("2d");

const playButton = document.querySelector("#playButton");
const resetButton = document.querySelector("#resetButton");

const growthInput = document.querySelector("#growthInput");
const speedInput = document.querySelector("#speedInput");

const growthValue = document.querySelector("#growthValue");
const speedValue = document.querySelector("#speedValue");

const plantCount = document.querySelector("#plantCount");
const herbCount = document.querySelector("#herbCount");
const predCount = document.querySelector("#predCount");

const timeText = document.querySelector("#timeText");
const runState = document.querySelector("#runState");
const toolHint = document.querySelector("#toolHint");

const eventList = document.querySelector("#eventList");
const toolButtons = document.querySelectorAll(".tool");

// ========================================
// 2. 基本参数
// 后续调试主要修改这一部分
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
  predator: "#c57030"
};

const TOOL_NAMES = {
  plant: "植物",
  herbivore: "食草动物",
  predator: "捕食者"
};

// ========================================
// 3. 保存世界状态
// ========================================

let plants = [];
let herbivores = [];
let predators = [];

let running = false;
let selectedTool = "plant";

let simulationTime = 0;
let plantBudget = 0;

let history = [];
let historyClock = 0;

let events = [];
let eventTimes = {};

let pointer = {
  x: 0,
  y: 0,
  inside: false
};

let previousTimestamp = null;
let accumulator = 0;

const STEP = 1 / 30;

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

  eventList.innerHTML = "";

  for (const event of events) {
    const li = document.createElement("li");
    li.textContent = `${event.time} 秒：${event.message}`;
    eventList.appendChild(li);
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
    type,
    x,
    y,
    angle: randomBetween(0, Math.PI * 2),
    turnClock: randomBetween(0.3, 1.5),
    energy: settings.energyStart,
    cooldown: settings.birthCooldown * randomBetween(0.5, 1),
    flash: 0
  };
}

function addEntity(type, x, y, manual = false) {
  x = clamp(x, 12, world.width - 12);
  y = clamp(y, 12, world.height - 12);

  if (type === "plant") {
    if (plants.length >= CONFIG.maxPlants) {
      if (manual) addEvent("植物已达到数量上限。", "plant-limit", 0);
      return false;
    }

    plants.push(createPlant(x, y));
  }

  if (type === "herbivore") {
    if (herbivores.length >= CONFIG.maxHerbivores) {
      if (manual) addEvent("食草动物已达到数量上限。", "herb-limit", 0);
      return false;
    }

    herbivores.push(createAnimal(type, x, y));
  }

  if (type === "predator") {
    if (predators.length >= CONFIG.maxPredators) {
      if (manual) addEvent("捕食者已达到数量上限。", "pred-limit", 0);
      return false;
    }

    predators.push(createAnimal(type, x, y));
  }

  if (manual) {
    addEvent(`手动添加了${TOOL_NAMES[type]}。`, "manual-add", 0);
  }

  return true;
}

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
// 7. 更新某一类动物
// ========================================

function updateAnimals(type, dt) {
  const isHerbivore = type === "herbivore";

  const animals = isHerbivore ? herbivores : predators;
  const food = isHerbivore ? plants : herbivores;

  const settings = CONFIG[type];

  const limit = isHerbivore
    ? CONFIG.maxHerbivores
    : CONFIG.maxPredators;

  const newborns = [];

  for (let i = animals.length - 1; i >= 0; i--) {
    const animal = animals[i];

    animal.energy -= settings.energyLoss * dt;
    animal.cooldown -= dt;
    animal.flash = Math.max(0, animal.flash - dt);

    if (animal.energy <= 0) {
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
        clamp(animal.x + randomBetween(-12, 12), 12, world.width - 12),
        clamp(animal.y + randomBetween(-12, 12), 12, world.height - 12)
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
// 8. 更新整个生态系统
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

    while (plantBudget >= 1 && plants.length < CONFIG.maxPlants) {
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
      "食草动物已经消失。可以暂停后手动补充。",
      "herb-extinct",
      0
    );
  }

  if (previousPredCount > 0 && predators.length === 0) {
    addEvent(
      "捕食者已经消失。可以补充，也可以继续观察。",
      "pred-extinct",
      0
    );
  }

  historyClock += dt;

  if (historyClock >= 1) {
    historyClock -= 1;
    recordHistory();
  }
}

// ========================================
// 9. 绘制生物和生态区域
// ========================================

function drawAnimal(animal) {
  const isHerbivore = animal.type === "herbivore";

  ctx.save();
  ctx.translate(animal.x, animal.y);

  if (animal.flash > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(201, 159, 56, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.rotate(animal.angle);
  ctx.fillStyle = COLORS[animal.type];

  if (isHerbivore) {
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(3, -2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

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

  for (const animal of herbivores) {
    drawAnimal(animal);
  }

  for (const animal of predators) {
    drawAnimal(animal);
  }

  if (pointer.inside) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = COLORS[selectedTool];
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  if (!running) {
    ctx.fillStyle = "rgba(36, 53, 44, 0.8)";
    ctx.font = "16px sans-serif";
    ctx.fillText("已暂停 · 可以继续添加生物", 18, 28);
  }
}

// ========================================
// 10. 绘制数量变化曲线
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

  for (let i = 0; i <= 4; i++) {
    const y = top + (plotHeight * i) / 4;
    const value = Math.round(maxValue * (1 - i / 4));

    chartCtx.strokeStyle = "#e4e9e1";
    chartCtx.beginPath();
    chartCtx.moveTo(left, y);
    chartCtx.lineTo(width - right, y);
    chartCtx.stroke();

    chartCtx.fillStyle = "#647469";
    chartCtx.fillText(String(value), left - 8, y + 4);
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

      if (index === 0) {
        chartCtx.moveTo(x, y);
      } else {
        chartCtx.lineTo(x, y);
      }
    });

    chartCtx.stroke();
  }

  chartCtx.fillStyle = "#647469";
  chartCtx.textAlign = "left";
  chartCtx.fillText(
    `${Math.floor(firstTime)} 秒`,
    left,
    height - 8
  );

  chartCtx.textAlign = "right";
  chartCtx.fillText(
    `${Math.floor(lastTime)} 秒`,
    width - right,
    height - 8
  );
}

// ========================================
// 11. 更新网页数字和按钮
// ========================================

function updateInterface() {
  plantCount.textContent = plants.length;
  herbCount.textContent = herbivores.length;
  predCount.textContent = predators.length;

  timeText.textContent = `${Math.floor(simulationTime)} 秒`;

  playButton.textContent = running ? "暂停模拟" : "开始模拟";
  runState.textContent = running ? "运行中" : "已暂停";

  growthValue.textContent = `${growthInput.value} 个/秒`;
  speedValue.textContent = `${speedInput.value}×`;

  toolHint.textContent =
    `当前工具：添加${TOOL_NAMES[selectedTool]}`;
}

function selectTool(type) {
  selectedTool = type;

  for (const button of toolButtons) {
    const active = button.dataset.tool === type;

    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  updateInterface();
}

// ========================================
// 12. 重置世界
// ========================================

function resetWorld() {
  running = false;

  plants = [];
  herbivores = [];
  predators = [];

  simulationTime = 0;
  plantBudget = 0;
  historyClock = 0;
  accumulator = 0;

  history = [];
  events = [];
  eventTimes = {};

  growthInput.value = "4";
  speedInput.value = "1";

  selectTool("plant");

  for (let i = 0; i < CONFIG.initialPlants; i++) {
    const position = randomPosition();
    addEntity("plant", position.x, position.y);
  }

  for (let i = 0; i < CONFIG.initialHerbivores; i++) {
    const position = randomPosition();
    addEntity("herbivore", position.x, position.y);
  }

  for (let i = 0; i < CONFIG.initialPredators; i++) {
    const position = randomPosition();
    addEntity("predator", position.x, position.y);
  }

  recordHistory();

  addEvent(
    "世界已准备好。点击“开始模拟”，或先添加生物。",
    "reset",
    0
  );

  updateInterface();
  drawWorld();
  drawChart();
}

// ========================================
// 13. 鼠标和按钮交互
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

world.addEventListener("click", (event) => {
  const position = getCanvasPosition(event);

  addEntity(
    selectedTool,
    position.x,
    position.y,
    true
  );

  updateInterface();
});

for (const button of toolButtons) {
  button.addEventListener("click", () => {
    selectTool(button.dataset.tool);
  });
}

playButton.addEventListener("click", () => {
  running = !running;
  accumulator = 0;
  updateInterface();
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm(
    "确定重置吗？当前生物和模拟记录将被清除。"
  );

  if (confirmed) resetWorld();
});

growthInput.addEventListener("input", updateInterface);

speedInput.addEventListener("input", () => {
  accumulator = 0;
  updateInterface();
});

// 切换浏览器标签页后，不补算离开期间的全部时间。
document.addEventListener("visibilitychange", () => {
  previousTimestamp = null;
  accumulator = 0;
});

// ========================================
// 14. 动画循环
// ========================================

function frame(timestamp) {
  if (previousTimestamp === null) {
    previousTimestamp = timestamp;
  }

  const realDelta = Math.min(
    (timestamp - previousTimestamp) / 1000,
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
  drawChart();
  updateInterface();

  requestAnimationFrame(frame);
}

resetWorld();
requestAnimationFrame(frame);
