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
  const firstEvent = state.data.events[0];
  state.cityKey = firstEvent?.cityKey;
  state.date = firstEvent?.date;
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
    state.date = datesForCity(state.cityKey)[0];
    renderSelectors();
    render();
  };

  dateSelect.innerHTML = "";
  for (const date of datesForCity(state.cityKey)) {
    dateSelect.append(new Option(date, date));
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
  document.querySelector("#generatedAt").textContent = `Generated ${formatGeneratedTime(state.data.generatedAt)}`;
  renderSummary(event, rows);
  renderSources();
  renderBracketLegend("#marketLegend", rows, "market");
  renderBracketLegend("#modelLegend", rows, "model");
  drawMultiLineChart({
    selector: "#marketChart",
    rows,
    lineKey: "polymarketLine",
    timezone,
    emptyMessage: "No Polymarket price history available yet",
  });
  drawMultiLineChart({
    selector: "#modelChart",
    rows,
    lineKey: "modelLine",
    timezone,
    emptyMessage: "No model trace available yet",
  });
  renderTable(event, rows);
}

function eventsForCity(cityKey) {
  return state.data.events.filter((event) => event.cityKey === cityKey);
}

function datesForCity(cityKey) {
  return eventsForCity(cityKey).map((event) => event.date).sort();
}

function selectedEvent() {
  return state.data.events.find((event) => event.cityKey === state.cityKey && event.date === state.date);
}

function cityForEvent(event) {
  return state.data.cities.find((item) => item.key === event.cityKey);
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
    .map((point) => ({ t: point.t, p: Number(point.p) }))
    .filter((point) => point.t && Number.isFinite(point.p));
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

function drawMultiLineChart({ selector, rows, lineKey, timezone, emptyMessage }) {
  const svg = document.querySelector(selector);
  svg.innerHTML = "";
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 320;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const margin = { top: 18, right: 18, bottom: 34, left: 46 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allPoints = rows.flatMap((row) => row[lineKey]).filter((point) => Number.isFinite(point.p));
  if (!allPoints.length) {
    text(svg, width / 2, height / 2, emptyMessage, "empty", "middle");
    return;
  }

  const times = allPoints.map((point) => new Date(point.t).getTime()).filter(Number.isFinite);
  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const x = (time) => margin.left + ((new Date(time).getTime() - minX) / Math.max(maxX - minX, 1)) * innerW;
  const y = (value) => margin.top + (1 - value) * innerH;

  for (let i = 0; i <= 4; i += 1) {
    const yy = margin.top + (innerH * i) / 4;
    line(svg, margin.left, yy, width - margin.right, yy, "grid");
    text(svg, 8, yy + 4, `${100 - i * 25}%`, "tick");
  }
  line(svg, margin.left, margin.top, margin.left, height - margin.bottom, "axis");
  line(svg, margin.left, height - margin.bottom, width - margin.right, height - margin.bottom, "axis");

  for (const tick of timeTicks(minX, maxX, 5)) {
    text(svg, margin.left + ((tick - minX) / Math.max(maxX - minX, 1)) * innerW, height - 10, shortTraceTime(tick, timezone), "tick", "middle");
  }

  for (const row of rows) {
    const tracePath = pathFor(row[lineKey], x, y);
    if (tracePath) path(svg, tracePath, row.color, "line", row.label);
  }
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
    parts.push(`${open ? "L" : "M"}${x(point.t).toFixed(2)},${y(point.p).toFixed(2)}`);
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

function shortTraceTime(value, timezone) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "NA";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
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
