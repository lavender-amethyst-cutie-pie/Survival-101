(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const state = {
    screen: "home",
    floor: 1,
    gems: 0,
    potions: 0,
    maxHealth: 100,
    health: 100,
    upgrades: { health: 0, speed: 0, damage: 0 },
    collected: 0,
    objectiveTotal: 3,
    objectiveText: "Find Lily's plushies",
    questComplete: false,
    dead: false,
    paused: false,
    dialogue: null,
    dialogueIndex: 0,
    lastDeath: { x: 800, y: 500 },
    deathFloor: 1,
    completedRuns: 0,
    hasCharm: false,
    hasBadge: false,
  };

  const saved = localStorage.getItem("survival101-save");
  if (saved) {
    try { Object.assign(state, JSON.parse(saved)); } catch (_) { /* Fresh save if storage is malformed. */ }
  }

  const canvas = $("#game-canvas");
  const ctx = canvas.getContext("2d");
  const WORLD = { w: 1600, h: 900 };
  let view = { scale: 1, x: 0, y: 0, w: 0, h: 0, dpr: 1 };
  let raf = 0;
  let lastFrame = 0;
  let toastTimer = 0;
  let dialogueCallback = null;
  let floorTransitionTimer = 0;
  let player;
  let entities = [];
  let props = [];
  let particles = [];
  let keys = new Set();
  let joystickVector = { x: 0, y: 0 };
  let joystickPointer = null;
  let attackCooldown = 0;
  let jumpTimer = 0;
  let cameraShake = 0;
  let endingStep = 0;

  const endingStory = [
    { kicker: "THE LAST LIGHT", title: "THE ROOM<br /><em>GOES QUIET.</em>", text: "Collin is gone. The hospital holds its breath, and Lily is the only thing left moving in the dark." },
    { kicker: "LILY // AGE 10", title: "A CHILD<br /><em>IN THE DARK.</em>", text: "Lily was only 10 years old when she died of leukemia. She never got the chance to grow up." },
    { kicker: "THE FILE", title: "SHE WAS<br /><em>HURT FIRST.</em>", text: "Before she died, Lily was bullied and even beaten. Saint Dymphna's became the place where all of that pain stayed." },
    { kicker: "THE HAUNTING", title: "PAIN<br /><em>REMAINED.</em>", text: "When Lily became a ghost, she haunted everyone who dared to come here. Fear was the only language people ever taught her." },
    { kicker: "UMRA // THE KIND ONE", title: "YOU<br /><em>FORGIVE HER.</em>", text: "You lower your weapon. Lily is not just a boss. She is a child who has been alone for far too long." },
    { kicker: "LILY // LAST WORDS", title: "SHE<br /><em>FADES.</em>", text: "Lily looks at you like forgiveness is something she had forgotten existed.", quote: "“You...you forgive me? Thank you... I have never seen someone this kind. Just don't come back unless you want to die.”" },
    { kicker: "EXIT // 03:17 AM", title: "THE SCREEN<br /><em>GOES BLACK.</em>", text: "Lily fades away. You step through the exit. Behind you, Saint Dymphna's goes still." },
  ];

  const COLORS = { acid: "#c8ef59", cream: "#f0eee8", lavender: "#c6c2e6", wall: "#20252a", floor: "#323739", tile: "#3a4040", red: "#df4b58", ghost: "#bde4cd", teal: "#88d0d2", coral: "#ff806e" };

  function persist() {
    const safe = { gems: state.gems, potions: state.potions, maxHealth: state.maxHealth, upgrades: state.upgrades, completedRuns: state.completedRuns, hasCharm: state.hasCharm, hasBadge: state.hasBadge, floor: state.floor };
    localStorage.setItem("survival101-save", JSON.stringify(safe));
  }

  function showScreen(name, options = {}) {
    state.screen = name;
    const targetId = name === "boosts" || name === "shop" ? "menu-screen" : `${name}-screen`;
    $$(".screen").forEach((screen) => screen.classList.toggle("active", screen.id === targetId));
    if (name === "home") updateHomeStats();
    if (name === "boosts" || name === "shop") updateMenu(name);
    if (name === "game") {
      if (options.newRun !== false) startRun();
      requestAnimationFrame(() => resizeCanvas());
    }
  }

  function updateHomeStats() {
    $("#home-gems").textContent = state.gems.toLocaleString();
    $("#home-potions").textContent = state.potions;
    $("#home-floor").textContent = `${String(Math.min(state.floor, 3)).padStart(2, "0")} / 03`;
  }

  function updateMenu(name) {
    $("#boosts-panel").classList.toggle("hidden", name !== "boosts");
    $("#shop-panel").classList.toggle("hidden", name !== "shop");
    $("#menu-eyebrow").textContent = name === "shop" ? "FIELD SUPPLY // BLACK MARKET" : "FIELD PREP";
    $("#menu-title").textContent = name === "shop" ? "SHOP" : "BOOST UPS";
    $("#menu-subtitle").textContent = name === "shop" ? "No refunds. No receipts. No questions after midnight." : "A little preparation goes a long way in a dark hospital.";
    $("#menu-gems").textContent = state.gems.toLocaleString();
    Object.entries(state.upgrades).forEach(([key, level]) => { const el = $(`#${key}-level`); if (el) el.textContent = `LEVEL ${level} / 3`; });
  }

  function startRun() {
    state.floor = 1; state.collected = 0; state.questComplete = false; state.dead = false; state.paused = false; state.health = state.maxHealth; state.objectiveTotal = 3; state.objectiveText = "Find Lily's plushies";
    player = { x: 770, y: 650, radius: 18, speed: 260, facing: 1, invuln: 0, attackFlash: 0, walk: 0 };
    applyUpgrades(); buildFloor(1); updateHUD(); hideGamePanels();
    beginDialogue([{ speaker: "LILY", tag: "THE UNFINISHED", avatar: "L", text: "You came. I thought everyone forgot about me." }, { speaker: "LILY", tag: "THE UNFINISHED", avatar: "L", text: "My three plushies are somewhere in this ward. Bring them to me... and I can finally leave." }, { speaker: "UMRA", tag: "THE HUNTER", avatar: "U", text: "I'll find them. Stay where the lights can reach you." }]);
  }

  function applyUpgrades() { player.speed = 260 + state.upgrades.speed * 28; state.maxHealth = 100 + state.upgrades.health * 15; state.health = Math.min(state.health, state.maxHealth); }

  function buildFloor(floor) {
    state.floor = floor; state.collected = 0; state.questComplete = false; entities = []; props = []; particles = [];
    player.x = floor === 1 ? 770 : floor === 2 ? 240 : 780; player.y = floor === 1 ? 650 : floor === 2 ? 690 : 690;
    const walls = [
      { x: 92, y: 150, w: 38, h: 600 }, { x: 1470, y: 150, w: 38, h: 600 }, { x: 92, y: 120, w: 1416, h: 36 }, { x: 92, y: 744, w: 1416, h: 36 },
      { x: 390, y: 155, w: 24, h: 200 }, { x: 390, y: 520, w: 24, h: 225 }, { x: 1172, y: 155, w: 24, h: 200 }, { x: 1172, y: 520, w: 24, h: 225 },
      { x: 415, y: 330, w: 190, h: 24 }, { x: 995, y: 330, w: 180, h: 24 }, { x: 415, y: 520, w: 190, h: 24 }, { x: 995, y: 520, w: 180, h: 24 },
    ];
    props = walls.map((wall) => ({ type: "wall", ...wall }));
    // Bed frames and abandoned equipment make each wing feel hand-built.
    const beds = [[190,190],[190,425],[1220,190],[1220,425],[650,190],[810,190],[650,585],[810,585]];
    beds.forEach(([x,y], i) => props.push({ type: "bed", x, y, w: 142, h: 54, flip: i % 2 }));
    const lamps = [[220,160],[1370,160],[220,700],[1370,700],[785,285],[785,610]];
    lamps.forEach(([x,y]) => props.push({ type: "lamp", x, y }));
    const portal = { type: "elevator", x: floor === 1 ? 1320 : floor === 2 ? 1320 : 1320, y: 404, w: 92, h: 112, locked: true };
    props.push(portal);
    if (floor === 1) {
      addEntity({ type: "lily", x: 800, y: 230, name: "Lily", hp: 1, solid: false });
      [[230,285],[1335,290],[785,430]].forEach(([x,y], i) => addEntity({ type: "plushie", x, y, id: i, bob: Math.random() * 6 }));
      [[560,240],[1050,240],[590,650],[1035,650]].forEach(([x,y], i) => addEntity({ type: "ghost", x, y, name: "Wailer", hp: 2, damage: 9, speed: 40, phase: i }));
    } else if (floor === 2) {
      addEntity({ type: "collin", x: 220, y: 660, name: "Collin", hp: 1, solid: false, companion: false });
      addEntity({ type: "candy", x: 1380, y: 260, id: 0 });
      [[500,245],[800,260],[1060,245],[550,640],[990,640]].forEach(([x,y], i) => addEntity({ type: ["skeleton", "zombie", "ghoul"][i % 3], x, y, hp: 2 + Math.floor(i/3), damage: 11, speed: 35, phase: i }));
    } else {
      props.push({ type: "chest", x: 720, y: 270, w: 160, h: 95 });
      addEntity({ type: "collin", x: 650, y: 650, name: "Collin", hp: 1, solid: false, companion: true });
      addEntity({ type: "lily", x: 800, y: 230, name: "Lily", hp: 1, solid: false, deceptive: true });
      [[270,240],[520,245],[1040,245],[1310,260],[780,650]].forEach(([x,y], i) => addEntity({ type: "skull", x, y, id: i, bob: Math.random() * 6 }));
      [[470,410],[620,470],[980,410],[1120,470],[800,570]].forEach(([x,y], i) => addEntity({ type: "ghoul", x, y, name: "Ghoul", hp: 3, damage: 14, speed: 48, phase: i }));
    }
    updateFloorLabels();
  }

  function addEntity(entity) { entities.push({ radius: entity.type === "lily" || entity.type === "collin" ? 25 : 18, alive: true, hitFlash: 0, attackTimer: 1 + Math.random(), ...entity }); }

  function updateFloorLabels() {
    const labels = { 1: ["FLOOR 01", "WEST WARD"], 2: ["FLOOR 02", "CHILDREN'S WING"], 3: ["FLOOR 03", "THE OLD CHAPEL"] };
    const [floorLabel, wing] = labels[state.floor]; $("#floor-label").innerHTML = `${floorLabel} <i>•</i> ${wing}`;
  }

  function updateHUD() {
    $("#game-gems").textContent = state.gems.toLocaleString(); $("#game-potions").textContent = state.potions; $("#health-text").textContent = `${Math.ceil(state.health)} / ${state.maxHealth}`;
    const ratio = Math.max(0, state.health / state.maxHealth); $("#health-fill").style.width = `${ratio * 100}%`; $("#health-fill").classList.toggle("low", ratio < .3);
    $("#quest-text").innerHTML = `${state.objectiveText} <b>${state.collected}/${state.objectiveTotal}</b>`; $("#quest-progress").style.width = `${Math.min(100, state.collected / state.objectiveTotal * 100)}%`;
    updateHomeStats();
  }

  function hideGamePanels() { $("#pause-panel").classList.add("hidden"); $("#death-panel").classList.add("hidden"); $("#dialogue-panel").classList.add("hidden"); }

  function beginDialogue(lines, callback) { state.dialogue = lines; state.dialogueIndex = 0; dialogueCallback = callback || null; showDialogueLine(); }
  function showDialogueLine() { const line = state.dialogue?.[state.dialogueIndex]; if (!line) return endDialogue(); $("#dialogue-speaker").innerHTML = `${line.speaker} <span>${line.tag}</span>`; $("#dialogue-avatar").textContent = line.avatar || line.speaker[0]; $("#dialogue-text").textContent = line.text; $("#dialogue-panel").classList.remove("hidden"); }
  function endDialogue() { state.dialogue = null; $("#dialogue-panel").classList.add("hidden"); if (dialogueCallback) { const callback = dialogueCallback; dialogueCallback = null; callback(); } }

  function showToast(text) { const el = $("#game-toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 1900); }

  function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale }; }
  function resizeCanvas() { const rect = canvas.getBoundingClientRect(); view.w = rect.width; view.h = rect.height; view.dpr = Math.min(window.devicePixelRatio || 1, 2); view.scale = Math.min(view.w / WORLD.w, view.h / WORLD.h); view.x = (view.w - WORLD.w * view.scale) / 2; view.y = (view.h - WORLD.h * view.scale) / 2; canvas.width = Math.floor(view.w * view.dpr); canvas.height = Math.floor(view.h * view.dpr); }
  function circleRectCollision(circle, rect) { const nearX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w)); const nearY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h)); const dx = circle.x - nearX; const dy = circle.y - nearY; return dx * dx + dy * dy < circle.radius * circle.radius; }
  function canMove(x, y) { const test = { x, y, radius: player.radius }; return x > 122 && x < 1478 && y > 150 && y < 750 && !props.some((p) => p.type === "wall" && circleRectCollision(test, p)); }
  function movePlayer(dx, dy, dt) { const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; } const amount = player.speed * dt; const nx = player.x + dx * amount; const ny = player.y + dy * amount; if (canMove(nx, player.y)) player.x = nx; if (canMove(player.x, ny)) player.y = ny; if (len > .05) { player.facing = dx < 0 ? -1 : 1; player.walk += dt * 10; } }

  function getMoveVector() { let x = joystickVector.x, y = joystickVector.y; if (keys.has("ArrowLeft") || keys.has("a")) x -= 1; if (keys.has("ArrowRight") || keys.has("d")) x += 1; if (keys.has("ArrowUp") || keys.has("w")) y -= 1; if (keys.has("ArrowDown") || keys.has("s")) y += 1; return { x, y }; }
  function attack() { if (state.dead || state.paused || state.dialogue || attackCooldown > 0) return; attackCooldown = .38; player.attackFlash = .2; cameraShake = .12; const reach = 92; let hit = false; entities.forEach((enemy) => { if (!enemy.alive || !["ghost", "skeleton", "zombie", "ghoul", "boss-teddy", "boss-lily"].includes(enemy.type)) return; const dx = enemy.x - player.x; const dy = enemy.y - player.y; const distance = Math.hypot(dx, dy); const inFront = player.facing === 1 ? dx > -25 : dx < 25; if (distance < reach && inFront) { const damage = 1 + state.upgrades.damage; enemy.hp -= damage; enemy.hitFlash = .2; burst(enemy.x, enemy.y, COLORS.acid, 7); hit = true; if (enemy.hp <= 0) killEntity(enemy); } }); if (hit) showToast("HIT CONFIRMED"); }
  function killEntity(enemy) { enemy.alive = false; state.gems += enemy.type.startsWith("boss") ? 450 : 35; burst(enemy.x, enemy.y, enemy.type === "boss-lily" ? COLORS.ghost : COLORS.coral, 18); if (state.floor === 2 && state.objectiveText === "Help Collin clear the wing") { state.collected += 1; updateHUD(); if (state.collected >= state.objectiveTotal) { state.objectiveText = "Enter the elevator"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); unlockElevator(); } } if (enemy.type === "boss-teddy") { state.objectiveText = "Return the plushies to Lily"; state.objectiveTotal = 3; state.collected = 3; state.questComplete = true; updateHUD(); beginDialogue([{ speaker: "LILY", tag: "THE UNFINISHED", avatar: "L", text: "You found them... all of them. The elevator is awake now." }], () => unlockElevator()); } if (enemy.type === "boss-lily") finishRun(); }
  function unlockElevator() { const elevator = props.find((p) => p.type === "elevator"); if (elevator) elevator.locked = false; state.objectiveText = state.floor === 3 ? "Find Lily in the dark" : "Enter the elevator"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); showToast("ELEVATOR UNLOCKED — FIND THE GREEN LIGHT"); }

  function collectEntity(item) { item.alive = false; state.collected += 1; burst(item.x, item.y, state.floor === 2 ? COLORS.coral : COLORS.acid, 12); if (state.floor === 1) { showToast("PLUSHIE RECOVERED"); if (state.collected >= 3) { state.objectiveText = "Defeat Miss Teddy"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); addEntity({ type: "boss-teddy", name: "Miss Teddy", x: 800, y: 410, hp: 7, damage: 18, speed: 24, radius: 38 }); showToast("MISS TEDDY HAS WOKEN UP"); } } else if (state.floor === 2) { state.objectiveText = "Give the candy to Collin"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); showToast("CANDY FOUND — TAKE IT TO COLLIN"); } else { showToast("SKULL RECOVERED"); if (state.collected >= 5) { state.objectiveText = "Return the skulls to Lily"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); showToast("THE CHEST IS EMPTY"); } } updateHUD(); }

  function interact() { if (state.dead || state.paused || state.dialogue) return; const nearby = entities.find((e) => e.alive && Math.hypot(e.x - player.x, e.y - player.y) < 64); if (state.floor === 2 && nearby?.type === "collin" && state.objectiveText === "Give the candy to Collin") { nearby.companion = true; state.objectiveText = "Enter the elevator"; state.objectiveTotal = 1; state.collected = 0; unlockElevator(); showToast("COLLIN JOINED THE HUNT — ELEVATOR OPEN"); } else if (state.floor === 3 && nearby?.type === "lily" && state.objectiveText === "Return the skulls to Lily") { state.objectiveText = "Find Lily in the dark"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); beginDialogue([{ speaker: "LILY", tag: "THE UNFINISHED", avatar: "L", text: "You brought them back. I can make the door now." }], () => { state.objectiveText = "Enter the door"; updateHUD(); showToast("A DOOR HAS OPENED — KEEP WALKING"); }); } else { const elevator = props.find((p) => p.type === "elevator"); if (elevator && !elevator.locked && Math.hypot(elevator.x + 46 - player.x, elevator.y + 56 - player.y) < 105) nextFloor(); } }

  function nextFloor() { if (floorTransitionTimer > 0) return; if (state.floor === 3) { const lily = entities.find((e) => e.type === "lily" && e.alive); if (lily && Math.hypot(lily.x - player.x, lily.y - player.y) < 110 && state.objectiveText === "Enter the door") { floorTransitionTimer = 1.5; $("#blackout").classList.remove("hidden"); showToast("THE LIGHTS GO OUT"); setTimeout(() => { $("#blackout").classList.add("hidden"); lily.alive = false; const collin = entities.find((e) => e.type === "collin" && e.alive); if (collin) collin.alive = false; addEntity({ type: "collin-dead", x: 930, y: 438, name: "Collin", hp: 0, solid: false }); addEntity({ type: "boss-lily", name: "Lily", x: 800, y: 420, hp: 12, damage: 20, speed: 38, radius: 34 }); state.objectiveText = "Defeat Lily"; state.objectiveTotal = 1; state.collected = 0; updateHUD(); beginDialogue([{ speaker: "LILY", tag: "THE FINAL BOSS", avatar: "L", text: "Why did you come back? Everyone who sees me leaves screaming." }, { speaker: "UMRA", tag: "THE HUNTER", avatar: "U", text: "You don't have to be alone anymore." }]); floorTransitionTimer = 0; }, 900); } return; } floorTransitionTimer = 1.2; showToast(`DESCENDING TO FLOOR 0${state.floor + 1}`); setTimeout(() => { state.floor += 1; state.health = state.maxHealth; const next = state.floor === 2 ? "Find the candy for Collin" : "Collect skulls from the chest"; state.objectiveText = next; state.objectiveTotal = state.floor === 2 ? 1 : 5; state.collected = 0; buildFloor(state.floor); updateHUD(); floorTransitionTimer = 0; if (state.floor === 2) beginDialogue([{ speaker: "COLLIN", tag: "THE OTHER HUNTER", avatar: "C", text: "Candy first, questions later. Then we clean out this whole floor." }]); }, 1150); }

  function takeDamage(amount) { if (player.invuln > 0 || state.dead) return; player.invuln = .75; state.health -= amount; cameraShake = .25; burst(player.x, player.y, COLORS.red, 8); updateHUD(); if (state.health <= 0) die(); }
  function die() { state.dead = true; state.deathFloor = state.floor; state.lastDeath = { x: player.x, y: player.y }; $("#death-floor").textContent = `FLOOR 0${state.deathFloor}`; $("#death-panel").classList.remove("hidden"); }
  function respawn() { const floor = state.deathFloor || state.floor || 1; if (state.screen !== "game") showScreen("game", { newRun: false }); state.floor = floor; state.dead = false; state.paused = false; state.dialogue = null; dialogueCallback = null; state.health = state.maxHealth; if (!player) { player = { x: 800, y: 500, radius: 18, speed: 260, facing: 1, invuln: 0, attackFlash: 0, walk: 0 }; applyUpgrades(); buildFloor(floor); } player.x = state.lastDeath?.x ?? player.x; player.y = state.lastDeath?.y ?? player.y; player.invuln = 2; $("#death-panel").classList.add("hidden"); updateHUD(); showToast(`RESPAWNED ON FLOOR 0${state.floor} — ITEMS KEPT`); }
  function heal() { if (state.dead || state.paused || state.dialogue || state.potions <= 0 || state.health >= state.maxHealth) return; state.potions -= 1; state.health = Math.min(state.maxHealth, state.health + state.maxHealth * .5); burst(player.x, player.y, COLORS.coral, 12); updateHUD(); showToast("VITALITY RESTORED +50%"); persist(); }
  function jump() { if (state.dead || state.paused || state.dialogue || jumpTimer > 0) return; jumpTimer = .42; burst(player.x, player.y + 12, COLORS.ghost, 8); }

  function update(dt) {
    if (state.screen !== "game" || state.paused || state.dead || state.dialogue) return;
    dt = Math.min(dt, .035); attackCooldown = Math.max(0, attackCooldown - dt); player.invuln = Math.max(0, player.invuln - dt); player.attackFlash = Math.max(0, player.attackFlash - dt); jumpTimer = Math.max(0, jumpTimer - dt); floorTransitionTimer = Math.max(0, floorTransitionTimer - dt);
    const move = getMoveVector(); movePlayer(move.x, move.y, dt);
    entities.forEach((entity) => {
      if (!entity.alive) return; entity.hitFlash = Math.max(0, entity.hitFlash - dt); entity.bob = (entity.bob || 0) + dt * 2;
      if (["plushie", "candy", "skull"].includes(entity.type) && Math.hypot(entity.x - player.x, entity.y - player.y) < 35) collectEntity(entity);
      if (entity.type === "collin" && state.objectiveText === "Give the candy to Collin" && Math.hypot(entity.x - player.x, entity.y - player.y) < 54) interact();
      if (entity.type === "collin" && entity.companion) updateCompanion(entity, dt);
      if (entity.type === "lily" && state.floor === 3 && state.objectiveText === "Return the skulls to Lily" && Math.hypot(entity.x - player.x, entity.y - player.y) < 60) interact();
      if (["ghost", "skeleton", "zombie", "ghoul", "boss-teddy", "boss-lily"].includes(entity.type)) updateEnemy(entity, dt);
    });
    const elevator = props.find((p) => p.type === "elevator"); if (elevator && !elevator.locked && state.objectiveText === "Enter the elevator" && Math.hypot(elevator.x + 46 - player.x, elevator.y + 56 - player.y) < 75) interact();
    if (state.floor === 3 && state.objectiveText === "Enter the door" && player.x > 720 && player.x < 900 && player.y < 320) nextFloor();
    particles.forEach((p) => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.vy += 20 * dt; }); particles = particles.filter((p) => p.life > 0);
  }
  function updateEnemy(enemy, dt) { const dx = player.x - enemy.x, dy = player.y - enemy.y, distance = Math.hypot(dx, dy); const isBoss = enemy.type.startsWith("boss"); const touchDistance = player.radius + (enemy.radius || 18) + 4; const active = distance < (isBoss ? 650 : 370); if (active && distance > touchDistance) { const speed = (enemy.speed || 40) * (state.floor === 2 ? 1.05 : 1); const nx = enemy.x + dx / distance * speed * dt, ny = enemy.y + dy / distance * speed * dt; if (canMove(nx, enemy.y)) enemy.x = nx; if (canMove(enemy.x, ny)) enemy.y = ny; } if (distance <= touchDistance) { enemy.attackTimer -= dt; if (enemy.attackTimer <= 0) { enemy.attackTimer = isBoss ? .85 : 1.05; takeDamage(enemy.damage || 8); } } }
  function updateCompanion(companion, dt) { const dx = player.x - companion.x, dy = player.y - companion.y, distance = Math.hypot(dx, dy); const followDistance = 78; if (distance > followDistance) { const targetX = player.x - player.facing * 54; const targetY = player.y + 30; const tx = targetX - companion.x; const ty = targetY - companion.y; const targetDistance = Math.hypot(tx, ty) || 1; const speed = distance > 220 ? 210 : 145; const nx = companion.x + tx / targetDistance * speed * dt; const ny = companion.y + ty / targetDistance * speed * dt; if (canMove(nx, companion.y)) companion.x = nx; if (canMove(companion.x, ny)) companion.y = ny; } companion.attackTimer -= dt; if (companion.attackTimer > 0) return; const target = entities.filter((entity) => entity.alive && ["ghost", "skeleton", "zombie", "ghoul", "boss-teddy", "boss-lily"].includes(entity.type)).sort((a, b) => Math.hypot(a.x - companion.x, a.y - companion.y) - Math.hypot(b.x - companion.x, b.y - companion.y))[0]; if (target && Math.hypot(target.x - companion.x, target.y - companion.y) < 205) { companion.attackTimer = .9; target.hp -= 2; target.hitFlash = .2; burst(target.x, target.y, COLORS.teal, 8); showToast("COLLIN STRIKES"); if (target.hp <= 0) killEntity(target); } }

  function burst(x, y, color, count) { for (let i = 0; i < count; i++) particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, life: .35 + Math.random() * .4, color, size: 2 + Math.random() * 3 }); }

  function draw() { if (!ctx || state.screen !== "game") return; ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.x, view.dpr * view.y); ctx.clearRect(0, 0, WORLD.w, WORLD.h); const shakeX = cameraShake ? (Math.random() - .5) * cameraShake * 18 : 0; const shakeY = cameraShake ? (Math.random() - .5) * cameraShake * 18 : 0; ctx.save(); ctx.translate(shakeX, shakeY); drawRoom(); props.filter((p) => p.type !== "wall").forEach(drawProp); entities.filter((e) => e.alive).sort((a,b) => a.y - b.y).forEach(drawEntity); drawPlayer(); particles.forEach((p) => { ctx.globalAlpha = Math.max(0, p.life * 1.8); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); }); ctx.globalAlpha = 1; ctx.restore(); cameraShake = Math.max(0, cameraShake - .016); }
  function drawRoom() { const g = ctx.createLinearGradient(0, 0, 0, WORLD.h); g.addColorStop(0, "#252d2f"); g.addColorStop(1, "#171b1c"); ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.w, WORLD.h); ctx.fillStyle = "#101316"; ctx.fillRect(92, 120, 1416, 660); ctx.fillStyle = COLORS.floor; ctx.fillRect(130, 158, 1340, 582); ctx.strokeStyle = "rgba(205,217,202,.055)"; ctx.lineWidth = 2; for (let x = 130; x < 1470; x += 55) { ctx.beginPath(); ctx.moveTo(x, 158); ctx.lineTo(x, 740); ctx.stroke(); } for (let y = 158; y < 740; y += 55) { ctx.beginPath(); ctx.moveTo(130, y); ctx.lineTo(1470, y); ctx.stroke(); } const light = ctx.createRadialGradient(800, 375, 40, 800, 375, 630); light.addColorStop(0, "rgba(163,211,179,.13)"); light.addColorStop(1, "transparent"); ctx.fillStyle = light; ctx.fillRect(130, 158, 1340, 582); ctx.fillStyle = "#131719"; ctx.fillRect(92,120,1416,36); ctx.fillRect(92,744,1416,36); props.filter((p) => p.type === "wall").forEach((wall) => { ctx.fillStyle = COLORS.wall; ctx.fillRect(wall.x, wall.y, wall.w, wall.h); ctx.fillStyle = "rgba(210,220,204,.1)"; ctx.fillRect(wall.x, wall.y, wall.w, 3); }); ctx.fillStyle = "rgba(200,239,89,.28)"; ctx.font = "700 12px Trebuchet MS"; ctx.fillText(`WARD 0${state.floor} // KEEP MOVING`, 151, 188); }
  function drawProp(p) { if (p.type === "bed") { ctx.fillStyle = "rgba(5,7,8,.3)"; ctx.fillRect(p.x + 5, p.y + 8, p.w, p.h); ctx.fillStyle = "#606b68"; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.fillStyle = "#c2c5b4"; ctx.fillRect(p.x + 7, p.y + 7, p.w - 21, p.h - 14); ctx.fillStyle = "#899891"; ctx.fillRect(p.x + 10, p.y + 10, 34, p.h - 20); ctx.fillStyle = "#444b4d"; ctx.fillRect(p.x + p.w - 7, p.y - 6, 5, p.h + 12); } else if (p.type === "lamp") { ctx.fillStyle = "rgba(201,235,164,.09)"; ctx.beginPath(); ctx.arc(p.x,p.y,60,0,Math.PI*2); ctx.fill(); ctx.fillStyle = COLORS.acid; ctx.fillRect(p.x - 5, p.y - 6, 10, 7); ctx.fillStyle = "#414c48"; ctx.fillRect(p.x - 2, p.y, 4, 15); } else if (p.type === "chest") { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(p.x + 8, p.y + 10, p.w, p.h); ctx.fillStyle = "#4c3733"; ctx.fillRect(p.x, p.y + 26, p.w, p.h - 26); ctx.fillStyle = "#6f4d42"; ctx.beginPath(); ctx.arc(p.x + p.w/2, p.y + 26, p.w/2, Math.PI, 0); ctx.fill(); ctx.fillStyle = COLORS.coral; ctx.fillRect(p.x + p.w/2 - 6, p.y + 25, 12, 15); ctx.strokeStyle = "#a27b60"; ctx.lineWidth = 2; ctx.strokeRect(p.x + 6, p.y + 32, p.w - 12, p.h - 38); } else if (p.type === "elevator") { const locked = p.locked; ctx.fillStyle = locked ? "#252a2b" : "#283b32"; ctx.fillRect(p.x, p.y, p.w, p.h); ctx.strokeStyle = locked ? "#586064" : COLORS.acid; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h); ctx.fillStyle = locked ? "#626a68" : COLORS.acid; ctx.fillRect(p.x + p.w/2 - 2, p.y + 10, 4, 10); ctx.fillStyle = locked ? "#404748" : "#a9dd70"; ctx.font = "700 10px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText(locked ? "LOCKED" : "NEXT", p.x + p.w/2, p.y + p.h + 17); ctx.textAlign = "left"; } }
  function drawDeadCollin() { ctx.globalAlpha = .78; ctx.fillStyle = "rgba(4, 5, 8, .46)"; ctx.beginPath(); ctx.ellipse(0, 19, 58, 15, -.12, 0, Math.PI * 2); ctx.fill(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#172330"; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(-27, 1); ctx.lineTo(27, 5); ctx.stroke(); ctx.strokeStyle = "#263b44"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-7, 4); ctx.lineTo(-25, 28); ctx.moveTo(12, 6); ctx.lineTo(6, 32); ctx.moveTo(-12, 0); ctx.lineTo(-28, 20); ctx.moveTo(17, 4); ctx.lineTo(34, 23); ctx.stroke(); ctx.fillStyle = "#9b756f"; ctx.beginPath(); ctx.arc(37, -6, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#141923"; ctx.beginPath(); ctx.arc(34, -12, 13, Math.PI, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#1b2530"; ctx.fillRect(-3, -7, 13, 20); ctx.fillStyle = "#a67d75"; ctx.beginPath(); ctx.arc(37, -6, 2, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#bab5a5"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(43, 22); ctx.lineTo(68, 35); ctx.stroke(); ctx.fillStyle = "#545969"; ctx.fillRect(65, 33, 8, 4); }

  function drawEntity(e) { const bob = Math.sin(e.bob || 0) * (e.type === "plushie" || e.type === "skull" || e.type === "candy" ? 4 : 1); ctx.save(); ctx.translate(e.x, e.y + bob); if (e.hitFlash > 0) ctx.globalAlpha = .55; if (e.type === "plushie") { ctx.fillStyle = "#a46d70"; ctx.beginPath(); ctx.arc(0, 3, 16, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = "#c4938d"; ctx.beginPath(); ctx.arc(-11,-12,7,0,Math.PI*2); ctx.arc(11,-12,7,0,Math.PI*2); ctx.fill(); ctx.fillStyle = "#252032"; ctx.fillRect(-6,0,4,4); ctx.fillRect(3,0,4,4); ctx.fillStyle = COLORS.coral; ctx.font = "14px Georgia"; ctx.textAlign="center"; ctx.fillText("♥",0,11); } else if (e.type === "candy") { ctx.fillStyle = COLORS.coral; ctx.rotate(-.15); ctx.fillRect(-8,-5,16,10); ctx.fillStyle = "#eef0dc"; ctx.fillRect(-12,-5,4,10); ctx.fillRect(8,-5,4,10); } else if (e.type === "skull") { ctx.fillStyle = "#d5d4bb"; ctx.beginPath(); ctx.arc(0,-3,14,Math.PI,0); ctx.lineTo(13,10); ctx.lineTo(-13,10); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#272c2d"; ctx.fillRect(-7,-3,4,5); ctx.fillRect(3,-3,4,5); ctx.fillRect(-5,9,3,6); ctx.fillRect(2,9,3,6); } else if (e.type === "lily") { drawGhost(0, e.deceptive ? "#b2c0bd" : COLORS.ghost, 1.08); ctx.fillStyle = COLORS.cream; ctx.font = "700 10px Trebuchet MS"; ctx.textAlign="center"; ctx.fillText(e.deceptive ? "?" : "LILY", 0, -42); } else if (e.type === "collin") { drawHunter(COLORS.teal, "C"); if (e.companion) { ctx.fillStyle = COLORS.teal; ctx.font = "700 9px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText("ALLY", 0, -44); } } else if (e.type === "collin-dead") { drawDeadCollin(); } else if (["ghost", "skeleton", "zombie", "ghoul", "boss-teddy", "boss-lily"].includes(e.type)) { if (e.type === "ghost") drawGhost(0, "#b7d6c8", .9); else if (e.type === "boss-lily") drawGhost(0, COLORS.ghost, 1.35); else if (e.type === "boss-teddy") drawTeddyBoss(); else if (e.type === "skeleton") drawSkeleton(); else if (e.type === "zombie") drawZombie(); else drawGhoul(); if (e.type.startsWith("boss")) { ctx.fillStyle = e.type === "boss-lily" ? COLORS.ghost : COLORS.coral; ctx.font = "700 11px Trebuchet MS"; ctx.textAlign="center"; ctx.fillText(e.name.toUpperCase(),0,-57); drawEnemyBar(e); } } ctx.restore(); }
  function drawGhost(offset, color, scale) { ctx.scale(scale, scale); ctx.globalAlpha *= .82; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0,-17,19,Math.PI,0); ctx.lineTo(19,16); ctx.quadraticCurveTo(9,7,0,18); ctx.quadraticCurveTo(-9,7,-19,16); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#1c272a"; ctx.fillRect(-8,-19,5,7); ctx.fillRect(3,-19,5,7); ctx.globalAlpha *= .5; ctx.beginPath(); ctx.arc(0,-14,28,0,Math.PI*2); ctx.fill(); }
  function drawHunter(color, letter) { ctx.fillStyle = "#af867d"; ctx.beginPath(); ctx.arc(0,-26,12,0,Math.PI*2); ctx.fill(); ctx.fillStyle = "#273b42"; ctx.fillRect(-14,-14,28,34); ctx.fillStyle = color; ctx.font = "700 11px Trebuchet MS"; ctx.textAlign="center"; ctx.fillText(letter,0,-23); ctx.fillStyle = "#19292e"; ctx.fillRect(-12,20,9,27); ctx.fillRect(3,20,9,27); ctx.fillStyle = color; ctx.fillRect(13,-10,5,45); }
  function drawTeddyBoss() { ctx.fillStyle = "#82585a"; ctx.beginPath(); ctx.arc(0,-16,32,0,Math.PI*2); ctx.fill(); ctx.fillStyle = "#a87976"; ctx.beginPath(); ctx.arc(-19,-42,13,0,Math.PI*2); ctx.arc(19,-42,13,0,Math.PI*2); ctx.fill(); ctx.fillStyle = "#181820"; ctx.fillRect(-14,-21,8,10); ctx.fillRect(6,-21,8,10); ctx.fillStyle = COLORS.coral; ctx.fillRect(-5,-1,10,5); ctx.fillStyle = "#583b41"; ctx.fillRect(-27,13,17,39); ctx.fillRect(10,13,17,39); ctx.strokeStyle = "#c49b82"; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(-13,-7); ctx.lineTo(12,8); ctx.stroke(); }
  function drawSkeleton() { ctx.strokeStyle = "#c9c7b2"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0,-25,11,0,Math.PI*2); ctx.moveTo(0,-13); ctx.lineTo(0,20); ctx.moveTo(-15,0); ctx.lineTo(15,0); ctx.moveTo(0,20); ctx.lineTo(-12,42); ctx.moveTo(0,20); ctx.lineTo(12,42); ctx.stroke(); ctx.fillStyle="#202628"; ctx.fillRect(-5,-28,4,5); ctx.fillRect(3,-28,4,5); }
  function drawZombie() { ctx.fillStyle="#6f8b79"; ctx.beginPath(); ctx.arc(0,-25,13,0,Math.PI*2); ctx.fill(); ctx.fillRect(-15,-12,30,39); ctx.fillStyle="#2a3433"; ctx.fillRect(-12,25,9,23); ctx.fillRect(4,25,9,23); ctx.fillStyle="#202426"; ctx.fillRect(-8,-28,4,7); ctx.fillRect(5,-26,4,5); }
  function drawGhoul() { ctx.fillStyle="#786e68"; ctx.beginPath(); ctx.arc(0,-26,14,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#57524f"; ctx.fillRect(-16,-13,32,32); ctx.fillStyle="#303032"; ctx.fillRect(-17,15,10,33); ctx.fillRect(7,15,10,33); ctx.fillStyle=COLORS.coral; ctx.fillRect(-8,-28,5,5); ctx.fillRect(4,-28,5,5); }
  function drawEnemyBar(e) { ctx.fillStyle="rgba(0,0,0,.7)"; ctx.fillRect(-32,-67,64,4); ctx.fillStyle=e.type==="boss-lily"?COLORS.ghost:COLORS.coral; ctx.fillRect(-32,-67,64*Math.max(0,e.hp/(e.type==="boss-lily"?12:7)),4); }
  function drawPlayer() { if (!player) return; ctx.save(); ctx.translate(player.x, player.y); const jumpOffset = jumpTimer > 0 ? -Math.sin((.42 - jumpTimer) / .42 * Math.PI) * 28 : 0; ctx.translate(0, jumpOffset); if (player.invuln > 0 && Math.floor(player.invuln * 10) % 2 === 0) ctx.globalAlpha = .45; ctx.fillStyle = "rgba(0,0,0,.38)"; ctx.beginPath(); ctx.ellipse(0, 31 - jumpOffset, 25, 8, 0, 0, Math.PI*2); ctx.fill(); ctx.fillStyle = "#0b0c12"; ctx.beginPath(); ctx.arc(0,-30,19,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#b88f84"; ctx.beginPath(); ctx.arc(0,-26,13,0,Math.PI*2); ctx.fill(); ctx.fillStyle="#0b0c12"; ctx.beginPath(); ctx.arc(-2,-34,17,Math.PI,Math.PI*2); ctx.fill(); ctx.fillStyle="#202b42"; ctx.fillRect(-15,-13,30,35); ctx.fillStyle="#b7d17c"; ctx.font="12px Georgia"; ctx.textAlign="center"; ctx.fillText("✣",0,4); ctx.fillStyle="#182039"; const walk = Math.sin(player.walk) * 3; ctx.fillRect(-11,22,9,27 + walk); ctx.fillRect(3,22,9,27 - walk); ctx.fillStyle="#bfbdaf"; ctx.fillRect(player.facing * 15,-8,5,49); if (player.attackFlash > 0) { ctx.strokeStyle=COLORS.acid; ctx.lineWidth=5; ctx.globalAlpha=.8; ctx.beginPath(); ctx.arc(player.facing*8,-6,57,player.facing===1?-1.15:2.0,player.facing===1?1.15:4.1); ctx.stroke(); } ctx.restore(); }

  function loop(timestamp) { const dt = (timestamp - lastFrame) / 1000 || 0; lastFrame = timestamp; update(dt); draw(); raf = requestAnimationFrame(loop); }

  // Navigation and menu interactions.
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => showScreen(button.dataset.go)));
  $("#dialogue-next").addEventListener("click", () => { if (!state.dialogue) return; state.dialogueIndex += 1; if (state.dialogueIndex >= state.dialogue.length) endDialogue(); else showDialogueLine(); });
  $("#pause-button").addEventListener("click", () => { if (state.dead || state.dialogue) return; state.paused = true; $("#pause-panel").classList.remove("hidden"); });
  $("#resume-button").addEventListener("click", () => { state.paused = false; $("#pause-panel").classList.add("hidden"); });
  let respawnPointerHandled = false;
  $("#respawn-button").addEventListener("pointerdown", (event) => { event.preventDefault(); respawnPointerHandled = true; respawn(); setTimeout(() => { respawnPointerHandled = false; }, 600); }, { passive: false });
  $("#respawn-button").addEventListener("click", () => { if (respawnPointerHandled) { respawnPointerHandled = false; return; } respawn(); });
  $("#ending-home").addEventListener("click", () => showScreen("home"));
  $("#ending-next").addEventListener("click", advanceEnding);
  $$('[data-upgrade]').forEach((button) => button.addEventListener("click", () => { const key = button.dataset.upgrade; const costs = { health: 350, speed: 500, damage: 450 }; if (state.upgrades[key] >= 3) { showToast("MAXIMUM LEVEL"); return; } if (state.gems < costs[key]) { button.textContent = `NEED ◆ ${costs[key]}`; setTimeout(() => button.innerHTML = `UPGRADE <b>◆ ${costs[key]}</b>`, 1000); return; } state.gems -= costs[key]; state.upgrades[key] += 1; persist(); updateMenu("boosts"); updateHomeStats(); }));
  $$('[data-buy]').forEach((button) => button.addEventListener("click", () => { const item = button.dataset.buy; const costs = { potion: 120, charm: 900, badge: 650 }; if ((item === "charm" && state.hasCharm) || (item === "badge" && state.hasBadge)) { button.textContent = "OWNED"; return; } if (state.gems < costs[item]) { button.textContent = `NEED ◆ ${costs[item]}`; setTimeout(() => button.textContent = "BUY", 1000); return; } state.gems -= costs[item]; if (item === "potion") state.potions += 1; if (item === "charm") state.hasCharm = true; if (item === "badge") state.hasBadge = true; persist(); updateMenu("shop"); updateHomeStats(); }));

  // Touch, mouse, and keyboard controls.
  window.addEventListener("keydown", (event) => { keys.add(event.key); if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault(); if (state.screen === "ending" && (event.key === " " || event.key === "Enter")) { event.preventDefault(); advanceEnding(); return; } if (event.key === " " || event.key === "Enter") attack(); if (event.key.toLowerCase() === "e") interact(); if (event.key.toLowerCase() === "q") heal(); if (event.key.toLowerCase() === "shift") jump(); });
  window.addEventListener("keyup", (event) => keys.delete(event.key));
  function bindAction(id, action) { const button = $(id); ["pointerdown", "touchstart"].forEach((eventName) => button.addEventListener(eventName, (event) => { event.preventDefault(); button.classList.add("pressed"); action(); }, { passive: false })); ["pointerup", "pointercancel", "pointerleave", "touchend"].forEach((eventName) => button.addEventListener(eventName, () => button.classList.remove("pressed"))); }
  bindAction("#attack-button", attack); bindAction("#heal-button", heal); bindAction("#jump-button", jump);
  $("#game-canvas").addEventListener("pointerdown", (event) => { if (state.screen !== "game" || state.dialogue || state.paused) return; if (event.button === 0) interact(); });
  const joystick = $("#joystick"), knob = $("#joystick-knob");
  function joystickPoint(event) { if (event.touches?.length) return event.touches[0]; return event; }
  function updateJoystick(clientX, clientY) { const rect = joystick.querySelector(".joystick-ring").getBoundingClientRect(); const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2; let dx = clientX - cx, dy = clientY - cy; const max = rect.width * .27; const distance = Math.hypot(dx, dy); if (distance > max) { dx = dx / distance * max; dy = dy / distance * max; } joystickVector = { x: dx / max, y: dy / max }; knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; }
  function resetJoystick() { joystickPointer = null; joystickVector = { x: 0, y: 0 }; knob.style.transform = "translate(-50%, -50%)"; }
  function startJoystick(event) { event.preventDefault(); const point = joystickPoint(event); joystickPointer = event.pointerId ?? "touch"; if (event.pointerId !== undefined && joystick.setPointerCapture) joystick.setPointerCapture(event.pointerId); updateJoystick(point.clientX, point.clientY); }
  function moveJoystick(event) { const pointerId = event.pointerId ?? "touch"; if (pointerId !== joystickPointer) return; event.preventDefault(); const point = joystickPoint(event); updateJoystick(point.clientX, point.clientY); }
  joystick.addEventListener("pointerdown", startJoystick, { passive: false }); joystick.addEventListener("pointermove", moveJoystick, { passive: false }); joystick.addEventListener("touchstart", startJoystick, { passive: false }); joystick.addEventListener("touchmove", moveJoystick, { passive: false });
  ["pointerup", "pointercancel", "lostpointercapture", "touchend", "touchcancel"].forEach((eventName) => joystick.addEventListener(eventName, resetJoystick, { passive: false }));
  window.addEventListener("resize", resizeCanvas); 

  function renderEndingStep() { const story = endingStory[endingStep]; $("#ending-story-kicker").textContent = story.kicker; $("#ending-story-count").textContent = `${String(endingStep + 1).padStart(2, "0")} / ${String(endingStory.length).padStart(2, "0")}`; $("#ending-story-title").innerHTML = story.title; $("#ending-story-text").textContent = story.text; $("#ending-story-quote").textContent = story.quote || ""; $("#ending-story-quote").classList.toggle("hidden", !story.quote); $("#ending-next").innerHTML = endingStep === endingStory.length - 1 ? "SEE YOUR REWARD <span>↵</span>" : "CONTINUE <span>↵</span>"; $("#ending-story-progress-fill").style.width = `${((endingStep + 1) / endingStory.length) * 100}%`; }
  function startEnding() { endingStep = 0; $("#ending-screen").classList.remove("story-blackout"); $("#ending-story").classList.remove("hidden"); $("#ending-final").classList.add("hidden"); $("#ending-whisper").classList.add("hidden"); renderEndingStep(); }
  function advanceEnding() { if (state.screen !== "ending") return; if (endingStep < endingStory.length - 1) { endingStep += 1; renderEndingStep(); return; } $("#ending-screen").classList.add("story-blackout"); setTimeout(() => { $("#ending-screen").classList.remove("story-blackout"); $("#ending-story").classList.add("hidden"); $("#ending-final").classList.remove("hidden"); $("#ending-whisper").classList.remove("hidden"); }, 850); }
  function finishRun() { state.completedRuns += 1; state.gems += 3000; state.potions += 5; persist(); showScreen("ending"); startEnding(); }
  updateHomeStats(); resizeCanvas(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
})();
