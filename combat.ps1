# Версия 2 — «Короткое приключение» (PowerShell)
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
        # только для героя
        ItemName = $null
        ItemAttackBonus = 0
        ItemDefenseBonus = 0
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
    if (-not $Unit) { return "0/0" }
    return "$($Unit.HP)/$($Unit.MaxHP)"
}

function Compute-Damage {
    param(
        [pscustomobject]$Attacker,
        [pscustomobject]$Defender,
        [double]$Multiplier = 1.0
    )
    # небольшая случайная вилка урона: -2..+2
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
    Write-Host ("- Статусы -")
    $itemText = if ($Hero.ItemName) { " | Предмет: $($Hero.ItemName)" } else { '' }
    Write-Host ("Герой: $($Hero.Name) | HP: $(Format-HP $Hero) | Атака: $($Hero.Attack) | Защита: $($Hero.Defense)$itemText")
    $i = 1
    foreach ($e in $Enemies) {
        $mark = if (Get-IsAlive $e) { 'ЖИВ' } else { 'МЁРТВ' }
        Write-Host ("[$i] $($e.Name) | $mark | HP: $(Format-HP $e) | Атк: $($e.Attack) | Защ: $($e.Defense)")
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
        Write-Host "Некорректный ввод. Введите номер живой цели." -ForegroundColor Yellow
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
# Механики предметов и лагеря
# ------------------------
function Equip-Item {
    param(
        [pscustomobject]$Hero,
        [ValidateSet('Power','Defense')] [string]$Item
    )
    # снять старый предмет
    if ($Hero.ItemName) {
        $Hero.Attack  -= $Hero.ItemAttackBonus
        $Hero.Defense -= $Hero.ItemDefenseBonus
        $Hero.ItemAttackBonus = 0
        $Hero.ItemDefenseBonus = 0
    }
    switch ($Item) {
        'Power' {
            $Hero.ItemName = 'Талисман силы (+2 Атаки)'
            $Hero.ItemAttackBonus = 2
            $Hero.Attack += 2
        }
        'Defense' {
            $Hero.ItemName = 'Амулет защиты (+2 Защиты)'
            $Hero.ItemDefenseBonus = 2
            $Hero.Defense += 2
        }
    }
    Add-Log "Герой экипировал: $($Hero.ItemName)"
}

function Do-CampChoice {
    param([pscustomobject]$Hero)
    Write-Host ''
    Write-Host '— Лагерь —' -ForegroundColor Cyan
    Write-Host 'Выберите одно из двух:'
    Write-Host '[1] Восстановить 40% текущих потерь HP'
    Write-Host '[2] +1 к Атаке (перманентно в этом забеге)'
    $choice = Read-Host 'Ваш выбор (1-2)'
    switch ($choice) {
        '1' {
            $missing = $Hero.MaxHP - $Hero.HP
            $heal = [int][math]::Floor($missing * 0.4)
            if ($heal -lt 1) { $heal = 1 }
            Perform-Heal -Hero $Hero -Amount $heal
            $script:CampChoice = 'Лечение 40% потерь'
        }
        '2' {
            $Hero.Attack += 1
            Add-Log "Герой получает перманентно +1 к Атаке (теперь $($Hero.Attack))."
            $script:CampChoice = '+1 к Атаке'
        }
        Default {
            Write-Host 'Неверный ввод — применено лечение.' -ForegroundColor Yellow
            $missing = $Hero.MaxHP - $Hero.HP
            $heal = [int][math]::Floor($missing * 0.4)
            if ($heal -lt 1) { $heal = 1 }
            Perform-Heal -Hero $Hero -Amount $heal
            $script:CampChoice = 'Лечение 40% потерь'
        }
    }
}

# ------------------------
# Бой как функция
# ------------------------
function Start-Combat {
    param(
        [pscustomobject]$Hero,
        [System.Collections.Generic.List[pscustomobject]]$Enemies,
        [string]$EncounterName = 'Бой',
        [bool]$IsBoss = $false
    )
    Add-Log "Начало: $EncounterName"
    $round = 1
    while ((Get-IsAlive $Hero) -and (Any-Enemy-Alive $Enemies)) {
        Write-Host ''
        Write-Host ("=== Раунд $round ===") -ForegroundColor Cyan
        Show-Status -Hero $Hero -Enemies $Enemies

        # Ход героя
        Write-Host ''
        Write-Host 'Ход героя: выберите действие:' -ForegroundColor Green
        Write-Host '[1] Обычная атака'
        Write-Host '[2] Рискованная атака (урон выше, шанс промаха)'
        Write-Host '[3] Лечение (фиксированный процент HP)'

        $choice = Read-Host 'Ваш выбор (1-3)'
        switch ($choice) {
            '1' {
                $idx = Choose-EnemyIndex -Enemies $Enemies
                if ($idx -ge 0) { Perform-Attack -Attacker $Hero -Defender $Enemies[$idx] -Multiplier 1.0 -MissChance 0.0 -Label 'атакует' }
            }
            '2' {
                $idx = Choose-EnemyIndex -Enemies $Enemies
                if ($idx -ge 0) { Perform-Attack -Attacker $Hero -Defender $Enemies[$idx] -Multiplier 1.8 -MissChance 0.35 -Label 'проводит мощный удар' }
            }
            '3' {
                $heal = [int][math]::Max([math]::Round($Hero.MaxHP * 0.25), 8)
                Perform-Heal -Hero $Hero -Amount $heal
            }
            Default {
                Write-Host 'Некорректно. Пропуск хода.' -ForegroundColor Yellow
                Add-Log 'Герой замешкался и теряет ход.'
            }
        }

        if (-not (Any-Enemy-Alive $Enemies)) { break }

        # Ходы врагов
        foreach ($enemy in $Enemies) {
            if ((Get-IsAlive $enemy) -and (Get-IsAlive $Hero)) {
                if ($IsBoss) {
                    $roll = Get-Random -Minimum 0.0 -Maximum 1.0
                    if ($roll -lt 0.10) {
                        Perform-Attack -Attacker $enemy -Defender $Hero -Multiplier 1.5 -MissChance 0.0 -Label 'применяет «Мощный удар»'
                    } else {
                        Perform-Attack -Attacker $enemy -Defender $Hero -Multiplier 1.0 -MissChance 0.05 -Label 'атакует'
                    }
                } else {
                    Perform-Attack -Attacker $enemy -Defender $Hero -Multiplier 1.0 -MissChance 0.05 -Label 'атакует'
                }
            }
        }

        $round++
    }

    if (Get-IsAlive $Hero) { Add-Log "Бой '$EncounterName' выигран." } else { Add-Log "Герой пал в бою '$EncounterName'." }

    [pscustomobject]@{
        HeroAlive = (Get-IsAlive $Hero)
        EnemiesAlive = (Any-Enemy-Alive $Enemies)
    }
}

function Show-NodeProgress {
    param([int]$Index,[int]$Total,[string]$Name,[string[]]$Remaining)
    $left = if ($Remaining -and $Remaining.Length -gt 0) { $Remaining -join ', ' } else { '—' }
    Write-Host ''
    Write-Host ("Узел ${Index}/${Total}: $Name | Осталось: $left") -ForegroundColor DarkCyan
}

# ------------------------
# Короткое приключение: Бой → Лагерь → Босс
# ------------------------
$script:BattleLog = [System.Collections.Generic.List[string]]::new()
$script:CampChoice = $null

$startTs = Get-Date

$hero = New-Combatant -Name 'Герой' -MaxHP 100 -Attack 20 -Defense 5 -Kind 'Hero'
Add-Log 'Вы отправились в короткий забег: Бой → Лагерь → Босс.'

# Узел 1: обычный бой
Show-NodeProgress -Index 1 -Total 3 -Name 'Бой' -Remaining @('Лагерь','Босс')
$enemies1 = [System.Collections.Generic.List[pscustomobject]]::new()
$enemies1.Add((New-Combatant -Name 'Орк-разведчик' -MaxHP 30 -Attack 10 -Defense 2 -Kind 'Enemy')) | Out-Null
$enemies1.Add((New-Combatant -Name 'Орк-воин'    -MaxHP 60 -Attack 15 -Defense 4 -Kind 'Enemy')) | Out-Null
$result1 = Start-Combat -Hero $hero -Enemies $enemies1 -EncounterName 'Стычка с орками' -IsBoss:$false
if (-not $result1.HeroAlive) {
    $endTs = Get-Date
    Write-Host ''
    Write-Host 'ИТОГИ ЗАБЕГА' -ForegroundColor Magenta
    Write-Host 'Поражение: герой пал до лагеря.'
    Write-Host ("Время: $([int]((New-TimeSpan -Start $startTs -End $endTs).TotalSeconds)) сек")
    Write-Host ("Предмет: " + (if ($hero.ItemName) { $hero.ItemName } else { 'нет' }))
    Write-Host ("Выбор в лагере: —")
    $logFile = Save-Log -Lines $script:BattleLog
    Write-Host ("Лог боя сохранён: $logFile") -ForegroundColor DarkCyan
    return
}

# Награда: предмет после первого боя
Write-Host ''
Write-Host 'Награда за бой: выберите предмет' -ForegroundColor Cyan
Write-Host '[1] Талисман силы: +2 к Атаке'
Write-Host '[2] Амулет защиты: +2 к Защите'
$itemChoice = Read-Host 'Ваш выбор (1-2)'
switch ($itemChoice) {
    '1' { Equip-Item -Hero $hero -Item Power }
    '2' { Equip-Item -Hero $hero -Item Defense }
    Default {
        Write-Host 'Неверно. Получен Талисман силы.' -ForegroundColor Yellow
        Equip-Item -Hero $hero -Item Power
    }
}

# Узел 2: лагерь
Show-NodeProgress -Index 2 -Total 3 -Name 'Лагерь' -Remaining @('Босс')
Do-CampChoice -Hero $hero

# Узел 3: босс
Show-NodeProgress -Index 3 -Total 3 -Name 'Босс' -Remaining @()
$bossList = [System.Collections.Generic.List[pscustomobject]]::new()
$boss = New-Combatant -Name 'Вожак орков' -MaxHP 120 -Attack 18 -Defense 6 -Kind 'Enemy'
$bossList.Add($boss) | Out-Null
$resultBoss = Start-Combat -Hero $hero -Enemies $bossList -EncounterName 'Вожак орков' -IsBoss:$true

$endTs = Get-Date
Write-Host ''
Write-Host 'ИТОГИ ЗАБЕГА' -ForegroundColor Magenta
if ($resultBoss.HeroAlive -and -not (Any-Enemy-Alive $bossList)) {
    Write-Host 'Победа: босс повержен!'
    Add-Log 'Победа в забеге!'
} else {
    Write-Host 'Поражение: герой пал на боссе.'
}
Write-Host ("Время: $([int]((New-TimeSpan -Start $startTs -End $endTs).TotalSeconds)) сек")
Write-Host ("Побед: $([int]($result1.HeroAlive)) + $([int]($resultBoss.HeroAlive -and -not (Any-Enemy-Alive $bossList))) = " + ([int]($result1.HeroAlive) + [int]($resultBoss.HeroAlive -and -not (Any-Enemy-Alive $bossList))))
Write-Host ("Предмет: " + (if ($hero.ItemName) { $hero.ItemName } else { 'нет' }))
Write-Host ("Выбор в лагере: " + (if ($script:CampChoice) { $script:CampChoice } else { '—' }))

$logFile = Save-Log -Lines $script:BattleLog
Write-Host ("Лог боя сохранён: $logFile") -ForegroundColor DarkCyan

