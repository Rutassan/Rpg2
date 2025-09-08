# Версия 1 — «Базовый бой» (PowerShell)
# Запуск: powershell -NoProfile -ExecutionPolicy Bypass -File .\combat.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ------------------------
# Утилиты
# ------------------------
function New-Combatant {
    param(
        [string]$Name,
        [int]$MaxHP,
        [int]$Attack,
        [int]$Defense,
        [ValidateSet('Hero','Enemy')] [string]$Kind
    )
    [pscustomobject]@{
        Kind    = $Kind
        Name    = $Name
        MaxHP   = $MaxHP
        HP      = $MaxHP
        Attack  = $Attack
        Defense = $Defense
    }
}

function Get-IsAlive {
    param([pscustomobject]$Unit)
    return [bool]($Unit.HP -gt 0)
}

function Clamp {
    param([int]$Value,[int]$Min,[int]$Max)
    if ($Value -lt $Min) { return $Min }
    if ($Value -gt $Max) { return $Max }
    return $Value
}

function Add-Log {
    param([string]$Message)
    $script:BattleLog.Add($Message) | Out-Null
    Write-Host $Message
}

function Format-HP {
    param([pscustomobject]$Unit)
    return "${($Unit.HP)}/${($Unit.MaxHP)}"
}

function Compute-Damage {
    param(
        [pscustomobject]$Attacker,
        [pscustomobject]$Defender,
        [double]$Multiplier = 1.0
    )
    # Небольшая случайная вилка урона: -2..+2
    $variance = Get-Random -Minimum -2 -Maximum 3
    $raw = [math]::Floor(($Attacker.Attack + $variance) * $Multiplier)
    $dmg = $raw - $Defender.Defense
    if ($dmg -lt 0) { $dmg = 0 }
    return [int]$dmg
}

function Perform-Attack {
    param(
        [pscustomobject]$Attacker,
        [pscustomobject]$Defender,
        [double]$Multiplier = 1.0,
        [double]$MissChance = 0.0,
        [string]$Label = 'атакует'
    )
    if (-not (Get-IsAlive $Attacker)) { return }
    if (-not (Get-IsAlive $Defender)) { return }

    $roll = Get-Random -Minimum 0.0 -Maximum 1.0
    if ($roll -lt $MissChance) {
        Add-Log ("$($Attacker.Name) $Label, но промахивается!")
        return
    }

    $dmg = Compute-Damage -Attacker $Attacker -Defender $Defender -Multiplier $Multiplier
    $Defender.HP = Clamp ($Defender.HP - $dmg) 0 $Defender.MaxHP
    if ($dmg -le 0) {
        Add-Log ("$($Attacker.Name) $Label, но броня $($Defender.Name) не пробита.")
    }
    else {
        Add-Log ("$($Attacker.Name) $Label $($Defender.Name) и наносит $dmg урона. [HP $($Defender.Name): $(Format-HP $Defender)]")
        if (-not (Get-IsAlive $Defender)) {
            Add-Log ("$($Defender.Name) повержен!")
        }
    }
}

function Perform-Heal {
    param(
        [pscustomobject]$Hero,
        [int]$Amount
    )
    if (-not (Get-IsAlive $Hero)) { return }
    $before = $Hero.HP
    $Hero.HP = Clamp ($Hero.HP + $Amount) 0 $Hero.MaxHP
    $delta = $Hero.HP - $before
    Add-Log ("$($Hero.Name) лечится на $delta HP. [HP героя: $(Format-HP $Hero)]")
}

function Show-Status {
    param(
        [pscustomobject]$Hero,
        [System.Collections.Generic.List[pscustomobject]]$Enemies
    )
    Write-Host ''
    Write-Host ("— Статус —")
    Write-Host ("Герой: $($Hero.Name) | HP: $(Format-HP $Hero) | Атака: $($Hero.Attack) | Защита: $($Hero.Defense)")
    $i = 1
    foreach ($e in $Enemies) {
        $mark = if (Get-IsAlive $e) { 'Жив' } else { 'Мёртв' }
        Write-Host ("[$i] $($e.Name) | $mark | HP: $(Format-HP $e) | Атк: $($e.Attack) | Зщт: $($e.Defense)")
        $i++
    }
}

function Choose-EnemyIndex {
    param([System.Collections.Generic.List[pscustomobject]]$Enemies)
    while ($true) {
        $living = @()
        for ($i = 0; $i -lt $Enemies.Count; $i++) {
            if (Get-IsAlive $Enemies[$i]) { $living += $i }
        }
        if ($living.Count -eq 0) { return -1 }
        $input = Read-Host "Выберите цель (номер)"
        if ([int]::TryParse($input, [ref]([int]$null))) {
            $idx = [int]$input - 1
            if ($idx -ge 0 -and $idx -lt $Enemies.Count -and (Get-IsAlive $Enemies[$idx])) {
                return $idx
            }
        }
        Write-Host "Неверный выбор. Введите номер живого врага." -ForegroundColor Yellow
    }
}

function Any-Enemy-Alive {
    param([System.Collections.Generic.List[pscustomobject]]$Enemies)
    foreach ($e in $Enemies) { if (Get-IsAlive $e) { return $true } }
    return $false
}

function Save-Log {
    param([System.Collections.Generic.List[string]]$Lines)
    $root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    $logDir = Join-Path $root 'logs'
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $file = Join-Path $logDir "battle-$stamp.txt"
    $Lines | Set-Content -Path $file -Encoding UTF8
    return $file
}

# ------------------------
# Инициализация боя
# ------------------------
$script:BattleLog = [System.Collections.Generic.List[string]]::new()

$hero = New-Combatant -Name 'Воин' -MaxHP 100 -Attack 20 -Defense 5 -Kind 'Hero'
$enemies = [System.Collections.Generic.List[pscustomobject]]::new()
$enemies.Add((New-Combatant -Name 'Слабый гоблин' -MaxHP 30 -Attack 10 -Defense 2 -Kind 'Enemy')) | Out-Null
$enemies.Add((New-Combatant -Name 'Сильный орк'    -MaxHP 60 -Attack 15 -Defense 4 -Kind 'Enemy')) | Out-Null

Add-Log "Бой начинается! Герой встречает двух врагов."

# ------------------------
# Игровой цикл
# ------------------------
$round = 1
while ((Get-IsAlive $hero) -and (Any-Enemy-Alive $enemies)) {
    Write-Host ''
    Write-Host ("=== Раунд $round ===") -ForegroundColor Cyan
    Show-Status -Hero $hero -Enemies $enemies

    # Ход героя
    Write-Host ''
    Write-Host "Ход героя: выберите действие:" -ForegroundColor Green
    Write-Host "[1] Обычная атака"
    Write-Host "[2] Сильная атака (больше урона, шанс промаха)"
    Write-Host "[3] Лечение (восстановить часть HP)"

    $choice = Read-Host 'Ваш выбор (1-3)'
    switch ($choice) {
        '1' {
            $idx = Choose-EnemyIndex -Enemies $enemies
            if ($idx -ge 0) {
                Perform-Attack -Attacker $hero -Defender $enemies[$idx] -Multiplier 1.0 -MissChance 0.0 -Label 'атакует'
            }
        }
        '2' {
            $idx = Choose-EnemyIndex -Enemies $enemies
            if ($idx -ge 0) {
                # Сильная атака: ~1.8x урон, 35% промах
                Perform-Attack -Attacker $hero -Defender $enemies[$idx] -Multiplier 1.8 -MissChance 0.35 -Label 'проводит сильную атаку по'
            }
        }
        '3' {
            # Лечение: 25% от максимума, минимум 8 HP
            $heal = [int][math]::Max([math]::Round($hero.MaxHP * 0.25), 8)
            Perform-Heal -Hero $hero -Amount $heal
        }
        Default {
            Write-Host 'Неверный ввод. Герой теряет ход.' -ForegroundColor Yellow
            Add-Log 'Герой смущается и теряет ход.'
        }
    }

    # Проверка победы после хода героя
    if (-not (Any-Enemy-Alive $enemies)) { break }

    # Ход врагов (каждый живой атакует героя)
    foreach ($enemy in $enemies) {
        if ((Get-IsAlive $enemy) -and (Get-IsAlive $hero)) {
            Perform-Attack -Attacker $enemy -Defender $hero -Multiplier 1.0 -MissChance 0.05 -Label 'атакует'
        }
    }

    $round++
}

# ------------------------
# Завершение боя
# ------------------------
Write-Host ''
if (Get-IsAlive $hero) {
    Add-Log 'Победа! Все враги повержены.'
} else {
    Add-Log 'Поражение... Герой пал в бою.'
}

$logFile = Save-Log -Lines $script:BattleLog
Write-Host ("Лог боя сохранён: $logFile") -ForegroundColor DarkCyan

