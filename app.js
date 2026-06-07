const state = {
  data: null,
  cityKey: null,
  date: null,
};

const bracketColors = [
  "#2563eb",
  "#0f766e",
  "#b45309",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#ca8a04",
  "#16a34a",
  "#db2777",
  "#475569",
  "#ea580c",
];

async function boot() {
  const response = await fetch("assets/data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load data: ${response.status}`);
  state.data = await response.json();
  const firstCity = state.data.cities.find((city) => eventsForCity(city.key).length);
  state.cityKey = firstCity?.key || state.data.events[0]?.cityKey;
  state.date = preferredDateForCity(state.cityKey);
  renderSelectors();
  render();
}

function renderSelectors() {
  const citySelect = document.querySelector("#citySelect");
  const dateSelect = document.querySelector("#dateSelect");

  citySelect.innerHTML = "";
  for (const city of state.data.cities) {
    if (!eventsForCity(city.key).length) continue;
    citySelect.append(new Option(`${city.name} (${city.station})`, city.key));
  }
  citySelect.value = state.cityKey;
  citySelect.onchange = () => {
    state.cityKey = citySelect.value;
    state.date = preferredDateForCity(state.cityKey);
    renderSelectors();
    render();
  };

  dateSelect.innerHTML = "";
  for (const date of datesForCity(state.cityKey)) {
    const event = eventsForCity(state.cityKey).find((item) => item.date === date);
    const suffix = Number.isFinite(event?.actualTmaxF) ? ` · official ${temp(event.actualTmaxF)}` : " · pending";
    dateSelect.append(new Option(`${date}${suffix}`, date));
  }
  dateSelect.value = state.date;
  dateSelect.onchange = () => {
    state.date = dateSelect.value;
    render();
  };
}

function render() {
  const event = selectedEvent();
  if (!event) return;
  const rows = eventSeries(event);
  const timezone = cityForEvent(event)?.timezone;
  const xDomain = eventTimeDomain(event);
  document.querySelector("#generatedAt").textContent = generatedLabel();
  renderSummary(event, rows);
  renderSources();
  renderBracketLegend("#marketLegend", rows, "market");
  renderBracketLegend("#modelLegend", rows, "model");
  drawMultiLineChart({
    selector: "#marketChart",
    rows,
    lineKey: "polymarketLine",
    timezone,
    xDomain,
    emptyMessage: "No Polymarket price history available yet",
  });
  drawMultiLineChart({
    selector: "#modelChart",
    rows,
    lineKey: "modelLine",
    timezone,
    xDomain,
    emptyMessage: "No model trace available yet",
  });
  renderTable(event, rows);
}

function eventsForCity(cityKey) {
  return state.data.events.filter((event) => event.cityKey === cityKey);
}

function datesForCity(cityKey) {
  return eventsForCity(cityKey)
    .map((event) => event.date)
    .sort()
    .reverse();
}

function preferredDateForCity(cityKey) {
  const events = eventsForCity(cityKey)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  return events.find((event) => Number.isFinite(event.actualTmaxF))?.date || events[0]?.date;
}

function selectedEvent() {
  return state.data.events.find((event) => event.cityKey === state.cityKey && event.date === state.date);
}

function cityForEvent(event) {
  return state.data.cities.find((item) => item.key === event.cityKey);
}

function eventTimeDomain(event) {
  if (!Array.isArray(event.climateDayUtc) || event.climateDayUtc.length < 2) return null;
  const start = new Date(event.climateDayUtc[0]).getTime();
  const end = new Date(event.climateDayUtc[1]).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return [start, end];
}

function eventSeries(event) {
  return (event.brackets || []).map((bracket, index) => {
    const series = state.data.series[bracket.marketSlug] || {};
    const polymarketLine = normalizeLine(series.polymarketLine);
    const modelLine = normalizeLine(series.modelLine);
    const market = latestValue(polymarketLine) ?? bracket.latestPolymarketPrice ?? bracket.currentYesPrice;
    const model = latestValue(modelLine) ?? bracket.latestModelProbability;
    const edge = Number.isFinite(model) && Number.isFinite(market) ? model - market : null;
    return {
      bracket,
      label: bracket.label,
      color: bracketColors[index % bracketColors.length],
      polymarketLine,
      modelLine,
      market,
      model,
      edge,
      resolvedYes: series.resolvedYes ?? bracket.resolvedYes,
    };
  });
}

function normalizeLine(points) {
  return (points || [])
    .map((point) => ({ t: point.t, p: Number(point.p), ms: new Date(point.t).getTime() }))
    .filter((point) => point.t && Number.isFinite(point.p) && Number.isFinite(point.ms))
    .sort((a, b) => a.ms - b.ms);
}

function renderSummary(event, rows) {
  const city = cityForEvent(event);
  const topMarket = maxBy(rows, (row) => row.market);
  const topModel = maxBy(rows, (row) => row.model);
  const bestEdge = maxBy(rows, (row) => row.edge);
  const metrics = [
    ["Station", event.station, `${city?.name || event.city} · ${event.date}`],
    ["Brackets", String(rows.length), bracketRange(rows)],
    ["Top Polymarket", topMarket ? `${topMarket.label} ${pct(topMarket.market)}` : "Pending", "highest YES price"],
    ["Top Model", topModel ? `${topModel.label} ${pct(topModel.model)}` : "Pending", "highest model probability"],
    ["Best Edge", bestEdge ? `${bestEdge.label} ${signedPct(bestEdge.edge)}` : "Pending", "model minus market"],
    ["Official High", temp(event.actualTmaxF), event.actualTmaxF == null ? "Final pending" : "Resolved"],
  ];
  document.querySelector("#summary").innerHTML = metrics
    .map(
      ([label, value, small]) => `
        <div class="metric">
          <div class="label">${escapeHtml(label)}</div>
          <div class="value">${escapeHtml(value)}</div>
          <div class="small">${escapeHtml(small)}</div>
        </div>
      `,
    )
    .join("");
}

function bracketRange(rows) {
  if (!rows.length) return "No brackets";
  return `${rows[0].label} to ${rows[rows.length - 1].label}`;
}

function maxBy(rows, getter) {
  let best = null;
  let bestValue = -Infinity;
  for (const row of rows) {
    const value = getter(row);
    if (Number.isFinite(value) && value > bestValue) {
      best = row;
      bestValue = value;
    }
  }
  return best;
}

function renderSources() {
  document.querySelector("#sourceLinks").innerHTML = state.data.sources
    .map((source) => `<a href="${source.url}">${escapeHtml(source.name)}</a>`)
    .join(" · ");
}

function renderBracketLegend(selector, rows, source) {
  document.querySelector(selector).innerHTML = rows
    .map((row) => {
      const value = source === "market" ? row.market : row.model;
      return `<span class="legend-item"><span class="swatch" style="background:${row.color}"></span>${escapeHtml(row.label)} <strong>${escapeHtml(pct(value))}</strong></span>`;
    })
    .join("");
}

function drawMultiLineChart({ selector, rows, lineKey, timezone, xDomain, emptyMessage }) {
  const svg = document.querySelector(selector);
  svg.innerHTML = "";
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const margin = { top: 18, right: 18, bottom: 34, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const domain = xDomain || dataTimeDomain(rows, lineKey);
  if (!domain) {
    text(svg, width / 2, height / 2, emptyMessage, "empty", "middle");
    return;
  }

  const [minX, maxX] = domain;
  const visibleRows = rows.map((row) => ({
    ...row,
    visibleLine: lineInsideDomain(row[lineKey], minX, maxX),
  }));
  const allPoints = visibleRows.flatMap((row) => row.visibleLine);
  const x = (time) => margin.left + ((time - minX) / Math.max(maxX - minX, 1)) * innerW;
  const y = (value) => margin.top + (1 - value) * innerH;

  for (let i = 0; i <= 4; i += 1) {
    const yy = margin.top + (innerH * i) / 4;
    line(svg, margin.left, yy, width - margin.right, yy, "grid");
    text(svg, 8, yy + 4, `${100 - i * 25}%`, "tick");
  }
  line(svg, margin.left, margin.top, margin.left, height - margin.bottom, "axis");
  line(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "axis");

  const ticks = timeTicks(minX, maxX, 5);
  ticks.forEach((tick, index) => {
    const anchor = index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle";
    text(svg, margin.left + ((tick - minX) / Math.max(maxX - minX, 1)) * innerW, height - 10, shortTraceTime(tick, timezone), "tick", anchor);
  });

  if (!allPoints.length) {
    text(svg, width / 2, height / 2, emptyMessage, "empty", "middle");
    return;
  }

  for (const row of visibleRows) {
    const tracePath = pathFor(row.visibleLine, x, y);
    if (tracePath) path(svg, tracePath, row.color, "line", row.label);
  }
}

function lineInsideDomain(points, minX, maxX) {
  if (!points.length) return [];
  const inDomain = points.filter((point) => point.ms >= minX && point.ms <= maxX);
  const startSource = lastAtOrBefore(points, minX) || firstAtOrAfter(points, minX);
  const line = [];
  if (startSource) line.push(domainPoint(minX, startSource.p));
  line.push(...inDomain.filter((point) => point.ms > minX && point.ms <= maxX));
  return dedupeByTime(line);
}

function lastAtOrBefore(points, time) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].ms <= time) return points[index];
  }
  return null;
}

function firstAtOrAfter(points, time) {
  for (const point of points) {
    if (point.ms >= time) return point;
  }
  return null;
}

function domainPoint(ms, p) {
  return { t: new Date(ms).toISOString(), ms, p };
}

function dedupeByTime(points) {
  const deduped = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && last.ms === point.ms) {
      deduped[deduped.length - 1] = point;
    } else {
      deduped.push(point);
    }
  }
  return deduped;
}

function dataTimeDomain(rows, lineKey) {
  const times = rows.flatMap((row) => row[lineKey]).map((point) => point.ms).filter(Number.isFinite);
  if (!times.length) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  return end > start ? [start, end] : [start, start + 1];
}

function timeTicks(minX, maxX, count) {
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return [];
  if (count <= 1 || minX === maxX) return [minX];
  return Array.from({ length: count }, (_, index) => minX + ((maxX - minX) * index) / (count - 1));
}

function pathFor(points, x, y) {
  const parts = [];
  let open = false;
  for (const point of points) {
    if (!Number.isFinite(point.p)) {
      open = false;
      continue;
    }
    parts.push(`${open ? "L" : "M"}${x(point.ms).toFixed(2)},${y(point.p).toFixed(2)}`);
    open = true;
  }
  return parts.join(" ");
}

function renderTable(event, rows) {
  document.querySelector("#updatesBody").innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td><span class="swatch table-swatch" style="background:${row.color}"></span>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(pct(row.market))}</td>
          <td>${escapeHtml(pct(row.model))}</td>
          <td>${escapeHtml(signedPct(row.edge))}</td>
          <td>${escapeHtml(resolutionText(event, row))}</td>
        </tr>
      `,
    )
    .join("");
}

function resolutionText(event, row) {
  if (event.actualTmaxF == null || row.resolvedYes == null) return "Pending";
  return row.resolvedYes ? "YES" : "NO";
}

function latestValue(points) {
  const value = points?.slice().reverse().find((point) => Number.isFinite(point.p))?.p;
  return Number.isFinite(value) ? value : null;
}

function path(svg, d, stroke, className, label) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
  node.setAttribute("d", d);
  node.setAttribute("stroke", stroke);
  node.setAttribute("class", className);
  if (label) {
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = label;
    node.append(title);
  }
  svg.append(node);
}

function line(svg, x1, y1, x2, y2, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "line");
  node.setAttribute("x1", x1);
  node.setAttribute("y1", y1);
  node.setAttribute("x2", x2);
  node.setAttribute("y2", y2);
  node.setAttribute("class", className);
  svg.append(node);
}

function text(svg, x, y, value, className, anchor = "start") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.setAttribute("x", x);
  node.setAttribute("y", y);
  node.setAttribute("class", className);
  node.setAttribute("text-anchor", anchor);
  node.textContent = value;
  svg.append(node);
}

function formatGeneratedTime(value) {
  if (!value) return "NA";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function generatedLabel() {
  if (state.data.polymarketRefreshedAt) {
    return `Polymarket ${formatGeneratedTime(state.data.polymarketRefreshedAt)} · Model ${formatGeneratedTime(state.data.modelGeneratedAt || state.data.generatedAt)}`;
  }
  return `Generated ${formatGeneratedTime(state.data.generatedAt)}`;
}

function shortTraceTime(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "NA";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function temp(value) {
  return Number.isFinite(value) ? `${Math.round(value)}F` : "Pending";
}

function pct(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "Pending";
}

function signedPct(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%` : "Pending";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

boot().catch((error) => {
  document.body.innerHTML = `<main><section class="chart-panel"><h2>Dashboard Error</h2><p>${escapeHtml(error.message)}</p></section></main>`;
});
