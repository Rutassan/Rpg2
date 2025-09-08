(() => {
  const el = (id) => document.getElementById(id);
  const logEl = el('log');
  const heroStatsEl = el('heroStats');
  const enemiesListEl = el('enemiesList');
  const overlayEl = el('overlay');
  const modalEl = el('modal');
  const canvas = el('battleCanvas');
  const ctx = canvas.getContext('2d');

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rnd = (min, max) => Math.random() * (max - min) + min;
  const rndi = (min, maxInclusive) => Math.floor(Math.random() * (maxInclusive - min + 1)) + min;
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const nowSec = () => Math.floor(performance.now() / 1000);

  const state = {
    scene: 'menu',
    startTs: 0,
    wins: 0,
    map: null,
    hero: null,
    enemies: [],
    isBoss: false,
    bossKey: null,
    round: 1,
    selectedTargetIndex: null,
    hoverEnemyIndex: null,
    bounds: [],
    log: [],
    turnInProgress: false,
  };

  function addLog(text, cls) {
    state.log.push(text);
    const div = document.createElement('div');
    div.className = 'log-line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function initHero() {
    return {
      kind: 'Hero',
      name: 'Герой',
      maxHP: 100,
      hp: 100,
      attack: 20,
      defense: 5,
      gold: 0,
      xp: 0,
      level: 1,
      critChance: 0.0,
      critMultiplier: 1.5,
      healBonus: 0.0,
      perks: [],
      itemName: null,
      itemAttackBonus: 0,
      itemDefenseBonus: 0,
      itemHPBonus: 0,
      weaknessTurns: 0,
    };
  }

  function equipItem(hero, key) {
    if (hero.itemName) {
      hero.attack -= hero.itemAttackBonus;
      hero.defense -= hero.itemDefenseBonus;
      if (hero.itemHPBonus > 0) {
        hero.maxHP -= hero.itemHPBonus;
        hero.hp = clamp(hero.hp, 0, hero.maxHP);
      }
      hero.itemAttackBonus = 0;
      hero.itemDefenseBonus = 0;
      hero.itemHPBonus = 0;
      hero.itemName = null;
    }
    switch (key) {
      case 'Sword':
        hero.itemName = 'Меч (+4 Атака)';
        hero.itemAttackBonus = 4;
        hero.attack += 4;
        addLog('Экипирован предмет: Меч (+4 Атака).');
        break;
      case 'Shield':
        hero.itemName = 'Щит (+3 Защита)';
        hero.itemDefenseBonus = 3;
        hero.defense += 3;
        addLog('Экипирован предмет: Щит (+3 Защита).');
        break;
      case 'RingHP':
        hero.itemName = 'Кольцо жизни (+20 HP)';
        hero.itemHPBonus = 20;
        hero.maxHP += 20;
        hero.hp = clamp(hero.hp, 0, hero.maxHP);
        addLog('Экипирован предмет: Кольцо жизни (+20 HP).');
        break;
    }
  }

  function formatHP(u) {
    return `${u.hp}/${u.maxHP}`;
  }

  function applyHealBonus(hero, amount) {
    if (hero.healBonus && hero.healBonus > 0) {
      return Math.ceil(amount * (1 + hero.healBonus));
    }
    return amount | 0;
  }

  function performHeal(hero, amount) {
    if (hero.hp <= 0) return;
    const before = hero.hp;
    hero.hp = clamp(hero.hp + amount, 0, hero.maxHP);
    const delta = hero.hp - before;
    addLog(`${hero.name} лечится на ${delta} HP. [HP: ${formatHP(hero)}]`, 'log-hit');
  }

  function variance() { return rndi(-2, 2); }

  function computeDamage(attacker, defender, mult) {
    let effective = mult;
    let crit = false;
    if (attacker.kind === 'Hero' && state.hero.weaknessTurns > 0) {
      effective *= 0.8;
    }
    if (attacker.kind === 'Hero' && state.hero.critChance > 0) {
      if (Math.random() < state.hero.critChance) {
        effective *= (state.hero.critMultiplier || 1.5);
        crit = true;
      }
    }
    const raw = Math.floor((attacker.attack + variance()) * effective);
    const dmg = Math.max(0, raw - defender.defense);
    return { dmg, crit };
  }

  function performAttackEx(attacker, defender, mult, missChance, label) {
    if (attacker.hp <= 0 || defender.hp <= 0) return { missed: true, dmg: 0, crit: false };
    const roll = Math.random();
    if (roll < missChance) {
      addLog(`${attacker.name} ${label}, но промахивается.`, 'log-miss');
      return { missed: true, dmg: 0, crit: false };
    }
    const { dmg, crit } = computeDamage(attacker, defender, mult);
    defender.hp = clamp(defender.hp - dmg, 0, defender.maxHP);
    if (dmg <= 0) {
      addLog(`${attacker.name} ${label}, но ${defender.name} не получает урона.`);
    } else {
      const critTxt = crit ? ' КРИТ!' : '';
      addLog(`${attacker.name} ${label} ${defender.name} на ${dmg} урона.${critTxt} [HP ${defender.name}: ${formatHP(defender)}]`, 'log-hit');
      if (defender.hp <= 0) addLog(`${defender.name} повержен!`, 'log-warn');
    }
    return { missed: false, dmg, crit };
  }

  function anyEnemyAlive() { return state.enemies.some(e => e.hp > 0); }

  function startCombat(name, enemies, isBoss, bossKey) {
    state.scene = 'combat';
    state.enemies = enemies;
    state.isBoss = !!isBoss;
    state.bossKey = bossKey || null;
    state.round = 1;
    state.selectedTargetIndex = null;
    addLog(`Начало боя: ${name}`);
    draw();
  }

  function giveCombatRewards(isBoss) {
    const xp = isBoss ? 60 : 20;
    const gold = isBoss ? 50 : 15;
    state.hero.xp += xp;
    state.hero.gold += gold;
    addLog(`Награда: +${xp} XP, +${gold} золота. [XP: ${state.hero.xp}, Золото: ${state.hero.gold}]`);
  }

  function checkLevelUp() {
    if (state.hero.level === 1 && state.hero.xp >= 50) {
      showPerkChoice();
    }
  }

  function showPerkChoice() {
    overlayEl.classList.remove('hidden');
    modalEl.innerHTML = '' +
      '<div class="title">Повышение уровня! Выберите перк</div>' +
      '<div class="row choices">' +
      '<button id="perkCrit" class="primary">+10% к шансу крита</button>' +
      '<button id="perkHeal">+20% к лечению</button>' +
      '</div>';
    el('perkCrit').onclick = () => {
      state.hero.level = 2;
      state.hero.critChance = (state.hero.critChance || 0) + 0.10;
      state.hero.perks.push('+10% крит');
      addLog('Перк получен: +10% крит.');
      overlayEl.classList.add('hidden');
      draw();
    };
    el('perkHeal').onclick = () => {
      state.hero.level = 2;
      state.hero.healBonus = (state.hero.healBonus || 0) + 0.20;
      state.hero.perks.push('+20% к лечению');
      addLog('Перк получен: +20% к лечению.');
      overlayEl.classList.add('hidden');
      draw();
    };
  }

  function buildMap() {
    const mids = ['Событие', 'Лагерь', 'Торговец', 'Бой'];
    const midA = choice(mids);
    const midB = choice(mids);
    const bosses = ['Вожак орков', 'Шаман гоблинов'];
    const bossA = choice(bosses);
    const bossB = bosses.find(b => b !== bossA);
    return { branch: null, midA, midB, bossA, bossB };
  }

  function showBranchChoice() {
    state.map = buildMap();
    overlayEl.classList.remove('hidden');
    const midTxt = (x) => x;
    modalEl.innerHTML = `
      <div class="title">Выбор пути</div>
      <div class="desc">Средний узел и босс ветки</div>
      <div class="row">
        <div style="flex:1; background:#141a23; border:1px solid #2a3240; border-radius:8px; padding:10px;">
          <div class="kpi"><b>Путь A</b></div>
          <div><span class="muted">Узел:</span> ${midTxt(state.map.midA)}</div>
          <div><span class="muted">Босс:</span> ${state.map.bossA}</div>
          <div class="choices" style="margin-top:10px"><button id="chooseA" class="primary">Путь A</button></div>
        </div>
        <div style="flex:1; background:#141a23; border:1px solid #2a3240; border-radius:8px; padding:10px;">
          <div class="kpi"><b>Путь B</b></div>
          <div><span class="muted">Узел:</span> ${midTxt(state.map.midB)}</div>
          <div><span class="muted">Босс:</span> ${state.map.bossB}</div>
          <div class="choices" style="margin-top:10px"><button id="chooseB" class="primary">Путь B</button></div>
        </div>
      </div>`;
    el('chooseA').onclick = () => { state.map.branch = 'A'; addLog('Выбран путь: A'); overlayEl.classList.add('hidden'); runMidNode(); };
    el('chooseB').onclick = () => { state.map.branch = 'B'; addLog('Выбран путь: B'); overlayEl.classList.add('hidden'); runMidNode(); };
  }

  function runMidNode() {
    const mid = state.map.branch === 'A' ? state.map.midA : state.map.midB;
    if (mid === 'Событие') return runEvent();
    if (mid === 'Лагерь') return runCamp();
    if (mid === 'Торговец') return runMerchant();
    if (mid === 'Бой') {
      const enemies = [
        { kind:'Enemy', name:'Боец-гоблин', maxHP:35, hp:35, attack:12, defense:3 },
        { kind:'Enemy', name:'Разбойник-гоблин', maxHP:40, hp:40, attack:14, defense:2 },
      ];
      startCombat('Засада гоблинов', enemies, false, null);
    }
  }

  function runBoss() {
    const bossName = state.map.branch === 'A' ? state.map.bossA : state.map.bossB;
    let boss;
    let key = null;
    if (bossName === 'Вожак орков') {
      boss = { kind:'Enemy', name:'Вожак орков', maxHP:120, hp:120, attack:18, defense:6 };
      key = 'orcWarlord';
    } else {
      boss = { kind:'Enemy', name:'Шаман гоблинов', maxHP:100, hp:100, attack:16, defense:4 };
      key = 'goblinShaman';
    }
    startCombat('Босс', [boss], true, key);
  }

  function endCombatIfNeeded() {
    if (state.hero.hp <= 0) {
      showSummary(false);
      return true;
    }
    if (!anyEnemyAlive()) {
      giveCombatRewards(state.isBoss);
      checkLevelUp();
      if (state.isBoss) {
        state.wins += 1;
        showSummary(true);
      } else if (!state.map) {
        showBranchChoice();
      } else {
        runBoss();
      }
      return true;
    }
    return false;
  }

  function handleEnemyTurn() {
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0 || state.hero.hp <= 0) continue;
      if (state.isBoss && state.bossKey === 'goblinShaman') {
        if (state.round % 3 === 0) {
          if (Math.random() < 0.5) {
            addLog('Шаман гоблинов накладывает «Злобный сглаз»!');
            performAttackEx(enemy, state.hero, 1.0, 0.05, 'атакует');
            if (state.hero.hp > 0) {
              state.hero.weaknessTurns = 2;
              addLog('Герой получает «Ослабление»: −20% Атаки на 2 хода.', 'log-warn');
            }
          } else {
            performAttackEx(enemy, state.hero, 1.0, 0.05, 'атакует');
          }
        } else {
          performAttackEx(enemy, state.hero, 1.0, 0.05, 'атакует');
        }
      } else if (state.isBoss && state.bossKey === 'orcWarlord') {
        if (Math.random() < 0.10) {
          performAttackEx(enemy, state.hero, 1.5, 0.0, 'использует «Мощный удар»');
        } else {
          performAttackEx(enemy, state.hero, 1.0, 0.05, 'атакует');
        }
      } else {
        performAttackEx(enemy, state.hero, 1.0, 0.05, 'атакует');
      }
    }
    if (state.hero.weaknessTurns > 0) {
      state.hero.weaknessTurns -= 1;
      if (state.hero.weaknessTurns === 0) addLog('«Ослабление» прошло.', 'log-warn');
    }
    addLog(`Конец раунда ${state.round}`);
    state.round += 1;
    draw();
    endCombatIfNeeded();
    state.turnInProgress = false;
  }

  function performHeroAction(kind) {
    if (state.scene !== 'combat' || state.turnInProgress) return;
    if (state.hero.hp <= 0) return;
    if ((kind === 'attack' || kind === 'power') && (state.selectedTargetIndex == null || state.enemies[state.selectedTargetIndex]?.hp <= 0)) {
      addLog('Выберите цель кликом по врагу.', 'log-warn');
      return;
    }
    state.turnInProgress = true;
    if (kind === 'attack') {
      const target = state.enemies[state.selectedTargetIndex];
      performAttackEx(state.hero, target, 1.0, 0.0, 'атакует');
    } else if (kind === 'power') {
      const target = state.enemies[state.selectedTargetIndex];
      performAttackEx(state.hero, target, 1.8, 0.35, 'наносит мощный удар');
    } else if (kind === 'heal') {
      let heal = Math.max(Math.round(state.hero.maxHP * 0.25), 8);
      heal = applyHealBonus(state.hero, heal);
      performHeal(state.hero, heal);
    }
    draw();
    if (endCombatIfNeeded()) { state.turnInProgress = false; return; }
    handleEnemyTurn();
  }

  function runMerchant() {
    overlayEl.classList.remove('hidden');
    const g = state.hero.gold;
    const canSword = g >= 30;
    const canShield = g >= 30;
    const canRing = g >= 40;
    modalEl.innerHTML = `
      <div class="title">Торговец — Золото: ${g}</div>
      <div class="desc">Можно купить ровно один предмет. Покупка заменяет предыдущий.</div>
      <div class="row choices">
        <button id="buySword" ${canSword ? '' : 'disabled'}>Меч (+4 атк) — 30g</button>
        <button id="buyShield" ${canShield ? '' : 'disabled'}>Щит (+3 защ) — 30g</button>
        <button id="buyRing" ${canRing ? '' : 'disabled'}>Кольцо жизни (+20 HP) — 40g</button>
        <button id="skip" class="primary">Далее</button>
      </div>`;
    el('buySword').onclick = () => { if (!canSword) return; state.hero.gold -= 30; equipItem(state.hero, 'Sword'); addLog('Куплено: Меч (+4 атк) за 30 золота.'); draw(); };
    el('buyShield').onclick = () => { if (!canShield) return; state.hero.gold -= 30; equipItem(state.hero, 'Shield'); addLog('Куплено: Щит (+3 защ) за 30 золота.'); draw(); };
    el('buyRing').onclick = () => { if (!canRing) return; state.hero.gold -= 40; equipItem(state.hero, 'RingHP'); addLog('Куплено: Кольцо жизни (+20 HP) за 40 золота.'); draw(); };
    el('skip').onclick = () => { overlayEl.classList.add('hidden'); runBoss(); };
  }

  function runEvent() {
    const ev = choice(['Сундук','Святилище','Зелье']);
    overlayEl.classList.remove('hidden');
    if (ev === 'Сундук') {
      modalEl.innerHTML = `
        <div class="title">Событие: Сундук</div>
        <div class="desc">Открыть (70% +20 золота; 30% ловушка −10% MaxHP) или пройти мимо.</div>
        <div class="row choices">
          <button id="openChest" class="primary">Открыть</button>
          <button id="skipChest">Пройти мимо</button>
        </div>`;
      el('openChest').onclick = () => {
        overlayEl.classList.add('hidden');
        if (Math.random() < 0.7) { state.hero.gold += 20; addLog('Сундук: +20 золота.'); }
        else { let dmg = Math.ceil(state.hero.maxHP * 0.10); if (dmg < 1) dmg = 1; state.hero.hp = clamp(state.hero.hp - dmg, 0, state.hero.maxHP); addLog(`Сундук: ловушка! Получено ${dmg} урона. [HP: ${formatHP(state.hero)}]`, 'log-bad'); }
        runBoss();
      };
      el('skipChest').onclick = () => { addLog('Сундук: пройти мимо.'); overlayEl.classList.add('hidden'); runBoss(); };
    } else if (ev === 'Святилище') {
      modalEl.innerHTML = `
        <div class="title">Событие: Святилище</div>
        <div class="desc">Пожертвовать 10 золота → лечить 25% недостающего HP (учитывает перк) или уйти.</div>
        <div class="row choices">
          <button id="donate" ${state.hero.gold >= 10 ? '' : 'disabled'}>Пожертвовать 10 золота</button>
          <button id="leaveShrine" class="primary">Уйти</button>
        </div>`;
      el('donate').onclick = () => {
        if (state.hero.gold < 10) { addLog('Святилище: не хватает золота.'); return; }
        state.hero.gold -= 10;
        const missing = state.hero.maxHP - state.hero.hp;
        let heal = Math.floor(missing * 0.25);
        if (heal < 1 && missing > 0) heal = 1;
        heal = applyHealBonus(state.hero, heal);
        performHeal(state.hero, heal);
        addLog('Святилище: исцеление.');
        overlayEl.classList.add('hidden');
        runBoss();
      };
      el('leaveShrine').onclick = () => { addLog('Святилище: уйти.'); overlayEl.classList.add('hidden'); runBoss(); };
    } else {
      modalEl.innerHTML = `
        <div class="title">Событие: Зелье</div>
        <div class="desc">Выпить (75% лечит 20% MaxHP; 25% яд −10% MaxHP) или не пить.</div>
        <div class="row choices">
          <button id="drink" class="primary">Выпить</button>
          <button id="noDrink">Не пить</button>
        </div>`;
      el('drink').onclick = () => {
        overlayEl.classList.add('hidden');
        if (Math.random() < 0.75) {
          let heal = Math.ceil(state.hero.maxHP * 0.20);
          heal = applyHealBonus(state.hero, heal);
          performHeal(state.hero, heal);
          addLog('Зелье: вы лечитесь.');
        } else {
          let dmg = Math.ceil(state.hero.maxHP * 0.10); if (dmg < 1) dmg = 1; state.hero.hp = clamp(state.hero.hp - dmg, 0, state.hero.maxHP); addLog(`Зелье: яд! −${dmg} HP. [HP: ${formatHP(state.hero)}]`, 'log-bad');
        }
        runBoss();
      };
      el('noDrink').onclick = () => { addLog('Зелье: не пить.'); overlayEl.classList.add('hidden'); runBoss(); };
    }
  }

  function runCamp() {
    overlayEl.classList.remove('hidden');
    modalEl.innerHTML = `
      <div class="title">Лагерь</div>
      <div class="desc">Выберите: лечение 40% недостающего HP (учитывает перк) или +1 к Атаке (постоянно).</div>
      <div class="row choices">
        <button id="campHeal" class="primary">Лечение</button>
        <button id="campAtk">+1 к Атаке</button>
      </div>`;
    el('campHeal').onclick = () => {
      const missing = state.hero.maxHP - state.hero.hp;
      let heal = Math.floor(missing * 0.4);
      if (heal < 1 && missing > 0) heal = 1;
      heal = applyHealBonus(state.hero, heal);
      performHeal(state.hero, heal);
      addLog('Лагерь: лечение.');
      overlayEl.classList.add('hidden');
      runBoss();
    };
    el('campAtk').onclick = () => {
      state.hero.attack += 1;
      addLog(`Лагерь: +1 к Атаке (теперь ${state.hero.attack}).`);
      overlayEl.classList.add('hidden');
      runBoss();
    };
  }

  function showSummary(victory) {
    state.scene = 'summary';
    overlayEl.classList.remove('hidden');
    const elapsed = nowSec() - state.startTs;
    const perksText = state.hero.perks.length ? state.hero.perks.join(', ') : '—';
    const itemText = state.hero.itemName ? state.hero.itemName : '—';
    const branch = state.map?.branch || '—';
    const boss = state.map ? (state.map.branch === 'A' ? state.map.bossA : state.map.bossB) : '—';
    modalEl.innerHTML = `
      <div class="title">${victory ? 'Победа!' : 'Поражение'}</div>
      <div class="desc">Время: ${elapsed} сек · Побед: ${state.wins} · Ветка: ${branch} · Босс: ${boss}</div>
      <div class="desc">Итог: Уровень ${state.hero.level} · XP ${state.hero.xp} · Золото ${state.hero.gold}</div>
      <div class="desc">Перки: ${perksText}</div>
      <div class="desc">Предмет: ${itemText}</div>
      <div class="choices"><button id="newRun" class="primary">Новый забег</button></div>`;
    el('newRun').onclick = () => { overlayEl.classList.add('hidden'); newRun(); };
  }

  function newRun() {
    state.scene = 'combat';
    state.startTs = nowSec();
    state.wins = 0;
    state.map = null;
    state.hero = initHero();
    state.log = [];
    logEl.innerHTML = '';
    addLog('Версия 3: карта из 5 узлов с ветвлением.');
    const enemies = [
      { kind:'Enemy', name:'Налётчик-орк', maxHP:30, hp:30, attack:10, defense:2 },
      { kind:'Enemy', name:'Воин-орк', maxHP:60, hp:60, attack:15, defense:4 },
    ];
    startCombat('Стычка с орками', enemies, false, null);
  }

  function drawHUD() {
    const perksText = state.hero.perks.length ? state.hero.perks.join(', ') : '—';
    const itemText = state.hero.itemName ? state.hero.itemName : '—';
    const xpCap = 50;
    const heroLine = `Герой: ${formatHP(state.hero)} | Атака: ${state.hero.attack} | Защита: ${state.hero.defense} | Ур: ${state.hero.level} | XP: ${state.hero.xp}/${xpCap} | Золото: ${state.hero.gold} | Перки: ${perksText} | Предмет: ${itemText}`;
    heroStatsEl.textContent = heroLine;
    const list = state.enemies.map((e, i) => {
      const mark = e.hp > 0 ? 'ЖИВ' : 'МЁРТВ';
      return `[${i+1}] ${e.name} | ${mark} | HP: ${formatHP(e)} | Ат: ${e.attack} | Защ: ${e.defense}`;
    }).join('\n');
    enemiesListEl.textContent = list || 'Враги отсутствуют';
    const haveTarget = state.selectedTargetIndex != null && state.enemies[state.selectedTargetIndex]?.hp > 0;
    el('btnAttack').disabled = state.scene !== 'combat' || !haveTarget || state.turnInProgress || state.hero.hp <= 0;
    el('btnPower').disabled = el('btnAttack').disabled;
    el('btnHeal').disabled = state.scene !== 'combat' || state.turnInProgress || state.hero.hp <= 0;
  }

  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width));
    canvas.height = Math.max(200, Math.floor(rect.height));
  }

  function drawUnit(u, x, y, w, h, isHero, highlighted) {
    ctx.save();
    ctx.fillStyle = isHero ? '#2b7a4b' : '#7a2b2b';
    ctx.strokeStyle = highlighted ? '#e6b35a' : '#2a3240';
    ctx.lineWidth = highlighted ? 3 : 2;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e6e6e6';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(u.name, x + w/2, y - 8);
    const barW = w;
    const barH = 8;
    const hpPct = u.hp / u.maxHP;
    ctx.fillStyle = '#3a3a3a';
    roundRect(ctx, x, y - 22, barW, barH, 4);
    ctx.fill();
    ctx.fillStyle = '#2ea653';
    roundRect(ctx, x, y - 22, Math.max(0, Math.floor(barW * hpPct)), barH, 4);
    ctx.fill();
    if (isHero && state.hero.weaknessTurns > 0) {
      const sx = x + w/2 - 20; const sy = y - 42;
      ctx.fillStyle = '#e6b35a';
      ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('W', sx, sy+3);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  }

  function layoutBattle() {
    state.bounds = [];
    const W = canvas.width;
    const H = canvas.height;
    const heroW = 80, heroH = 120; const hx = 60, hy = Math.floor(H*0.55) - heroH/2;
    const aliveEnemies = state.enemies.filter(e => e.hp > 0);
    const total = state.enemies.length;
    const cols = total;
    const enemyW = 80, enemyH = 110;
    const gap = 30;
    const startX = Math.floor(W*0.55);
    const totalW = cols * enemyW + (cols-1)*gap;
    let ex = startX + Math.max(0, (W*0.4 - totalW)/2);
    const ey = Math.floor(H*0.55) - enemyH/2;
    const heroBounds = { x: hx, y: hy, w: heroW, h: heroH, index: -1 };
    state.bounds.push(heroBounds);
    for (let i=0;i<state.enemies.length;i++) {
      const b = { x: ex, y: ey, w: enemyW, h: enemyH, index: i };
      state.bounds.push(b);
      ex += enemyW + gap;
    }
  }

  function draw() {
    fitCanvas();
    layoutBattle();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#0c0f13';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#10151c';
    ctx.fillRect(0,0,canvas.width,Math.floor(canvas.height*0.5));
    ctx.fillStyle = '#0d1219';
    ctx.fillRect(0,Math.floor(canvas.height*0.5),canvas.width,Math.floor(canvas.height*0.5));
    const hb = state.bounds[0];
    drawUnit(state.hero, hb.x, hb.y, hb.w, hb.h, true, false);
    for (let i=1;i<state.bounds.length;i++) {
      const b = state.bounds[i];
      const idx = b.index;
      const enemy = state.enemies[idx];
      const highlighted = (idx === state.hoverEnemyIndex) || (idx === state.selectedTargetIndex);
      drawUnit(enemy, b.x, b.y, b.w, b.h, false, highlighted);
    }
    drawHUD();
  }

  function pickEnemyAt(mx, my) {
    for (let i=1;i<state.bounds.length;i++) {
      const b = state.bounds[i];
      if (mx >= b.x && mx <= b.x+b.w && my >= b.y && my <= b.y+b.h) return b.index;
    }
    return null;
  }

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    state.hoverEnemyIndex = pickEnemyAt(mx, my);
    draw();
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const idx = pickEnemyAt(mx, my);
    if (idx != null && state.enemies[idx]?.hp > 0) {
      state.selectedTargetIndex = idx;
      addLog(`Цель выбрана: ${state.enemies[idx].name}`);
      draw();
    }
  });

  el('btnAttack').onclick = () => performHeroAction('attack');
  el('btnPower').onclick = () => performHeroAction('power');
  el('btnHeal').onclick = () => performHeroAction('heal');
  el('btnNewRun').onclick = () => newRun();

  window.addEventListener('resize', draw);
  draw();
})();
