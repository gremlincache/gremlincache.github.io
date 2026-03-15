// Rarity map & user-editable overrides
const RARITY_MAP = {
    "Common":      0.75,
    "Uncommon":    0.30,
    "Scarce":      0.03,
    "Rare":        0.01,
    "Very Rarely": 0.0003,
};

const customRates = { ...RARITY_MAP };
const itemRateOverrides = {};

function getRateValue(label) {
    return customRates[label] ?? RARITY_MAP[label] ?? 0;
}

// Precomputed enemy encounter rates
// enemyRates[venueKey][enemyName] = appearances / totalPacks
const enemyRates = {};

function precompute() {
    for (const [venueKey, { packs }] of Object.entries(window.packData)) {
        const total = packs.length;
        if (!total) continue;
        const counts = {};
        packs.forEach(pack => pack.forEach(name => {
            counts[name] = (counts[name] || 0) + 1;
        }));
        const rates = {};
        for (const [name, count] of Object.entries(counts)) {
            rates[name] = count / total;
        }
        enemyRates[venueKey] = rates;
    }
}

// Drop rate resolution
// Returns the numeric drop rate for a specific enemy for this item,
// or null if the item has no dropRate data (falls back to manual selector).
function resolveDropRate(item, enemyName) {
    const dr = item.dropRate;
    if (!dr) return null;

    const overrides = itemRateOverrides[currentItemId] ?? {};

    function applyOverride(label) {
        return getRateValue(overrides[label] ?? label);
    }

    if (typeof dr === 'string') return applyOverride(dr);

    const enemy = window.enemyData[enemyName];
    for (const rule of dr) {
        if (rule.enemies && rule.enemies.includes(enemyName)) return applyOverride(rule.rate);
        if (rule.element && enemy && rule.element.includes(enemy.element)) return applyOverride(rule.rate);
    }
    const fallback = dr.find(r => !r.enemies && !r.element);
    return fallback ? applyOverride(fallback.rate) : null;
}

function getItemRateLabels(item) {
    const dr = item.dropRate;
    if (!dr) return null;
    if (typeof dr === 'string') return [dr];
    return [...new Set(dr.map(r => r.rate))];
}

// Valid enemy resolution
function getValidEnemiesForVenue(item, venueKey) {
    const packs = window.packData[venueKey]?.packs ?? [];
    if (!packs.length) return new Set();

    const venueEnemies = new Set();
    packs.forEach(pack => pack.forEach(name => venueEnemies.add(name)));

    const valid = new Set();

    if (item.enemies) {
        item.enemies.forEach(name => { if (venueEnemies.has(name)) valid.add(name); });
    } else if (item.allVenues) {
        if (item.excludeVenues?.includes(venueKey)) return new Set();
        venueEnemies.forEach(name => {
            const enemy = window.enemyData[name];
            if (!enemy) return;
            if (item.element && !item.element.includes(enemy.element)) return;
            valid.add(name);
        });
    } else if (item.venues) {
        if (!item.venues.includes(venueKey)) return new Set();
        venueEnemies.forEach(name => valid.add(name));
    } else if (item.element) {
        venueEnemies.forEach(name => {
            const enemy = window.enemyData[name];
            if (enemy && item.element.includes(enemy.element)) valid.add(name);
        });
    } else {
        venueEnemies.forEach(name => valid.add(name));
    }

    item.additionalEnemies?.forEach(name => { if (venueEnemies.has(name)) valid.add(name); });
    item.excludeEnemies?.forEach(name => valid.delete(name));

    return valid;
}

// Stats calculation
function calculateStats(item, customBpm) {
    const hasItemRates = !!item.dropRate;
    const manualRate = hasItemRates ? null : getManualDropRate();
    const results = [];

    for (const [venueKey, venueInfo] of Object.entries(window.venueData)) {
        const validEnemies = getValidEnemiesForVenue(item, venueKey);
        if (!validEnemies.size) continue;

        const rates = enemyRates[venueKey] ?? {};
        let encounterRate = 0;
        let weightedDropRate = 0;

        validEnemies.forEach(name => {
            const er = rates[name] ?? 0;
            encounterRate += er;
            if (hasItemRates) weightedDropRate += er * (resolveDropRate(item, name) ?? 0);
        });

        if (encounterRate === 0) continue;

        const bpm = customBpm[venueKey] ?? venueInfo.battlesPerMinute;
        const encPerMin = encounterRate * bpm;

        let timePerDrop = null;
        if (hasItemRates) {
            const dropsPerMin = weightedDropRate * bpm;
            if (dropsPerMin > 0) timePerDrop = 1 / dropsPerMin;
        } else if (manualRate > 0 && encPerMin > 0) {
            timePerDrop = 1 / (encPerMin * manualRate);
        }

        results.push({ venueKey, display: venueInfo.display, encounterRate, encPerMin, timePerDrop });
    }

    return results;
}

// Helpers 
function getManualDropRate() {
    const sel = document.getElementById('raritySelect');
    if (sel.value === 'custom') {
        const val = parseFloat(document.getElementById('customRarity').value);
        return (val > 0 ? val : 5) / 100;
    }
    return parseFloat(sel.value);
}

function formatTime(minutes) {
    if (minutes === null || !isFinite(minutes)) return '—';
    if (minutes < 1) return `${Math.round(minutes * 60)}s`;
    if (minutes < 60) return `${minutes.toFixed(1)}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
}

function fmt(n) { return n.toFixed(3); }

function describeSource(item) {
    if (!item.enemies && !item.element && !item.venues && !item.allVenues) return 'Drops from all enemies in all venues.';
    if (item.enemies) {
        const extra = item.additionalEnemies ? ` + ${item.additionalEnemies.join(', ')}` : '';
        return `Specific enemies: ${item.enemies.join(', ')}${extra}`;
    }
    if (item.allVenues) {
        const parts = ['All venues'];
        if (item.element) parts.push(`${item.element.join(', ')} enemies only`);
        if (item.excludeVenues?.length) parts.push(`excludes ${item.excludeVenues.map(k => window.venueData[k]?.display ?? k).join(', ')}`);
        if (item.additionalEnemies?.length) parts.push(`+ ${item.additionalEnemies.join(', ')}`);
        return parts.join(' · ');
    }
    if (item.venues) {
        const extra = item.additionalEnemies ? ` + ${item.additionalEnemies.join(', ')}` : '';
        return `Venues: ${item.venues.map(k => window.venueData[k]?.display ?? k).join(', ')}${extra}`;
    }
    if (item.element) return `Element: ${item.element.join(', ')}`;
    return '';
}

// Rarity editor panel
function buildRarityPanel() {
    const grid = document.getElementById('rarityGrid');
    grid.innerHTML = '';
    for (const [label, defaultVal] of Object.entries(RARITY_MAP)) {
        const row = document.createElement('div');
        row.className = 'bpm-row';
        row.innerHTML = `
            <label>${label}</label>
            <input type="number" min="0.001" max="100" step="any"
                value="${parseFloat((customRates[label] * 100).toPrecision(2))}"
                data-rate="${label}">
            <span class="bpm-default">${parseFloat((defaultVal * 100).toPrecision(2))}%</span>
        `;
        row.querySelector('input').addEventListener('input', e => {
            const val = parseFloat(e.target.value);
            customRates[label] = val > 0 ? val / 100 : RARITY_MAP[label];
            if (currentItemId) renderResults(currentItemId);
        });
        grid.appendChild(row);
    }
}

function resetRarityPanel() {
    Object.assign(customRates, RARITY_MAP);
    document.querySelectorAll('#rarityGrid input').forEach(input => {
        input.value = parseFloat((RARITY_MAP[input.dataset.rate] * 100).toPrecision(2));
    });
    if (currentItemId) renderResults(currentItemId);
}

// Autocomplete
let allItems = [];
let acSelectedIndex = -1;

function buildItemList() {
    allItems = Object.entries(window.itemIndex)
        .map(([id, item]) => ({ id, name: item.name, category: item.category }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function showAutocomplete(query) {
    const list = document.getElementById('autocomplete');
    if (!query) { list.classList.add('hidden'); return; }
    const q = query.toLowerCase();
    const matches = allItems.filter(item =>
        item.name.toLowerCase().includes(q) || item.id === query
    ).slice(0, 20);
    if (!matches.length) { list.classList.add('hidden'); return; }
    list.innerHTML = '';
    acSelectedIndex = -1;
    matches.forEach(item => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.innerHTML = `<span>${item.name}</span><span class="item-id">${item.id} · ${item.category}</span>`;
        div.addEventListener('mousedown', e => { e.preventDefault(); selectItem(item.id); });
        list.appendChild(div);
    });
    list.classList.remove('hidden');
}

function selectItem(id) {
    const item = window.itemIndex[id];
    if (!item) return;
    document.getElementById('itemSearch').value = item.name;
    document.getElementById('autocomplete').classList.add('hidden');
    renderResults(id);
}

// BPM panel
const customBpm = {};

function buildBpmPanel() {
    const grid = document.getElementById('bpmGrid');
    grid.innerHTML = '';
    for (const [key, venue] of Object.entries(window.venueData)) {
        const row = document.createElement('div');
        row.className = 'bpm-row';
        row.innerHTML = `
            <label title="${venue.display}">${venue.display}</label>
            <input type="number" min="0.1" max="60" step="0.1"
                placeholder="${venue.battlesPerMinute}" data-venue="${key}">
            <span class="bpm-default">${venue.battlesPerMinute}</span>
        `;
        row.querySelector('input').addEventListener('input', e => {
            const val = parseFloat(e.target.value);
            if (val > 0) customBpm[key] = val;
            else delete customBpm[key];
            if (currentItemId) renderResults(currentItemId);
        });
        grid.appendChild(row);
    }
}

// Render
let currentItemId = null;

function getSortMode() { return document.getElementById('sortSelect').value; }

function renderItemRates(item) {
    const labels = getItemRateLabels(item);
    const staticContainer = document.getElementById('itemRates');
    const overrideContainer = document.getElementById('itemRatesOverride');
    const manualGroup = document.getElementById('manualRarityGroup');
    const customGroup = document.getElementById('customRarityGroup');
    const itemRatesGroup = document.getElementById('itemRatesGroup');

if (!labels) {
    itemRatesGroup.classList.remove('visible');
    manualGroup.classList.remove('hidden');
    const isCustom = document.getElementById('raritySelect').value === 'custom';
    customGroup.classList.toggle('hidden', !isCustom);
    return;
}

    manualGroup.classList.add('hidden');
    customGroup.classList.add('hidden');
    itemRatesGroup.classList.add('visible');

    const overrides = itemRateOverrides[currentItemId] ?? {};

    staticContainer.innerHTML = `<label>Drop Rarity</label>` +
        labels.map(label => `<span class="rate-chip">${label}</span>`).join('');

    overrideContainer.innerHTML = `<label>Override Rarity</label>` +
        labels.map(label => {
            const active = overrides[label] ?? label;
            return `
                <select class="rate-chip-select" data-rate-chip="${label}">
                    ${Object.keys(RARITY_MAP).map(l =>
                        `<option value="${l}"${l === active ? ' selected' : ''}>${l} (${parseFloat((getRateValue(l) * 100).toPrecision(2))}%)</option>`
                    ).join('')}
                </select>
            `;
        }).join('');

    overrideContainer.querySelectorAll('.rate-chip-select').forEach(select => {
        select.addEventListener('change', () => {
            const label = select.dataset.rateChip;
            if (!itemRateOverrides[currentItemId]) itemRateOverrides[currentItemId] = {};
            if (select.value === label) delete itemRateOverrides[currentItemId][label];
            else itemRateOverrides[currentItemId][label] = select.value;
            renderResults(currentItemId);
        });
    });
}

function renderResults(id) {
    currentItemId = id;
    const item = window.itemIndex[id];
    if (!item) return;

    const sortMode = getSortMode();
    let results = calculateStats(item, customBpm);

    if (sortMode === 'encPerMin') results.sort((a, b) => b.encPerMin - a.encPerMin);
    else if (sortMode === 'encRate') results.sort((a, b) => b.encounterRate - a.encounterRate);
    else if (sortMode === 'timePerDrop') results.sort((a, b) => (a.timePerDrop ?? Infinity) - (b.timePerDrop ?? Infinity));

    const section = document.getElementById('resultsSection');
    const emptyState = document.getElementById('emptyState');
    const noResults = document.getElementById('noResults');
    const tbody = document.getElementById('resultsBody');
    const table = document.getElementById('resultsTable');

    emptyState.style.display = 'none';
    section.classList.remove('hidden');

    document.getElementById('itemInfo').innerHTML = `
        <h2>${item.name}</h2>
        <div class="item-meta">ID: ${id} · Category: ${item.category}</div>
        <div class="item-source">${describeSource(item)}</div>
    `;

    renderItemRates(item);

    if (!results.length) {
        noResults.classList.remove('hidden');
        noResults.textContent = 'No venues found where this item can drop with the current data.';
        table.style.display = 'none';
        return;
    }

    noResults.classList.add('hidden');
    table.style.display = '';

    document.querySelectorAll('.results-table th.sortable').forEach(th => {
        th.classList.toggle('active', th.dataset.sort === sortMode);
    });

    tbody.innerHTML = '';
    results.forEach((row, i) => {
        const rank = i + 1;
        const rankClass = rank <= 3 ? ` rank-${rank}` : '';
        const rankLabel = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank;
        const hilEnc  = sortMode === 'encRate'     ? ' highlight' : '';
        const hilEPM  = sortMode === 'encPerMin'   ? ' highlight' : '';
        const hilTime = sortMode === 'timePerDrop' ? ' highlight' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="td-rank${rankClass}">${rankLabel}</td>
            <td class="td-venue">${row.display}</td>
            <td class="td-num${hilEnc}">${fmt(row.encounterRate)}</td>
            <td class="td-num${hilEPM}">${fmt(row.encPerMin)}</td>
            <td class="td-num${hilTime}">${formatTime(row.timePerDrop)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    precompute();
    buildItemList();
    buildBpmPanel();
    buildRarityPanel();

    const searchInput = document.getElementById('itemSearch');
    const autocompleteList = document.getElementById('autocomplete');

    searchInput.addEventListener('input', () => showAutocomplete(searchInput.value));

    searchInput.addEventListener('keydown', e => {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            acSelectedIndex = Math.min(acSelectedIndex + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            acSelectedIndex = Math.max(acSelectedIndex - 1, 0);
        } else if (e.key === 'Enter') {
            if (acSelectedIndex >= 0) { e.preventDefault(); items[acSelectedIndex]?.dispatchEvent(new Event('mousedown')); }
            return;
        } else if (e.key === 'Escape') {
            autocompleteList.classList.add('hidden');
            return;
        } else { return; }
        items.forEach((item, i) => item.classList.toggle('selected', i === acSelectedIndex));
    });

    searchInput.addEventListener('blur', () => {
        setTimeout(() => autocompleteList.classList.add('hidden'), 150);
    });

    document.querySelectorAll('.results-table th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            document.getElementById('sortSelect').value = th.dataset.sort;
            if (currentItemId) renderResults(currentItemId);
        });
    });

    document.getElementById('sortSelect').addEventListener('change', () => {
        if (currentItemId) renderResults(currentItemId);
    });

    document.getElementById('raritySelect').addEventListener('change', () => {
        const isCustom = document.getElementById('raritySelect').value === 'custom';
        document.getElementById('customRarityGroup').classList.toggle('hidden', !isCustom);
        if (currentItemId) renderResults(currentItemId);
    });

    document.getElementById('customRarity').addEventListener('input', () => {
        if (currentItemId) renderResults(currentItemId);
    });

    document.getElementById('bpmToggle').addEventListener('click', () => {
        const panel = document.getElementById('bpmPanel');
        const btn = document.getElementById('bpmToggle');
        panel.classList.toggle('hidden');
        btn.classList.toggle('active', !panel.classList.contains('hidden'));
    });

    document.getElementById('resetBpm').addEventListener('click', () => {
        Object.keys(customBpm).forEach(k => delete customBpm[k]);
        document.querySelectorAll('.bpm-row input').forEach(input => { input.value = ''; });
        if (currentItemId) renderResults(currentItemId);
    });

    document.getElementById('rarityEditorToggle').addEventListener('click', () => {
        const panel = document.getElementById('rarityEditorPanel');
        const btn = document.getElementById('rarityEditorToggle');
        panel.classList.toggle('hidden');
        btn.classList.toggle('active', !panel.classList.contains('hidden'));
    });

    document.getElementById('resetRarity').addEventListener('click', resetRarityPanel);
});
